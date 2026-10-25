#!/usr/bin/env bash
# The "recorded" sound style's samples (src/sounds/recorded/<kind>-<n>.mp3, see CREDITS.md there) from
# their CC0 / public-domain originals:
#
#   tools/make-sounds.sh <download dir>
#
# Downloads every original into <download dir> unless it is there already (freesound.org's HQ previews -
# no login needed - and Kenney's Impact Sounds zip), then cuts each clip, makes it mono 44.1 kHz, fades
# it in / out, sets its level and encodes it as MP3 (96 kbps CBR, no tags). Needs curl, unzip, ffmpeg
# (with libmp3lame), awk.
#
# Levels: each clip's RMS over its first 0.25 s (its attack: the part one hears) is brought to its
# kind's target - destroy loudest, then fire, hit, impact, bump, dig quietest (it repeats while a tank
# digs) - with a lookahead limiter keeping the peaks at -1.5 dBFS (two passes: the limiter takes a little
# off, the second pass makes up for it). speaker.js plays them all through one gain (RECORDED_GAIN).
# Prints each clip's attack RMS / peak / length at the end.
set -euo pipefail
export LC_ALL=C
DL="${1:?usage: $0 <download dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src/sounds/recorded"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DL" "$OUT"

# ------------------------------------------------------------ originals
fetch() {   # fetch <url> <file in DL>
  [ -s "$DL/$2" ] || curl -sSfL -A "Mozilla/5.0" -o "$DL/$2" "$1"
}
# freesound.org (all "Creative Commons 0"; page: https://freesound.org/s/<id>/)
fetch https://cdn.freesound.org/previews/187/187767_71257-hq.mp3       fs-187767-cannon-shot.mp3        # qubodup, Cannon Shot (US Government video, public domain)
fetch https://cdn.freesound.org/previews/702/702455_13447096-hq.mp3    fs-702455-6pdr-gun.mp3           # AdamHarvester, 6 Pdr gun (recorded at Tankfest)
fetch https://cdn.freesound.org/previews/182/182429_71257-hq.mp3       fs-182429-explosion.mp3          # qubodup, Explosion (US Government video, public domain)
fetch https://cdn.freesound.org/previews/239/239137_71257-hq.mp3       fs-239137-artillery.mp3          # qubodup, Artillery Gunfire (US Government video, public domain)
fetch https://cdn.freesound.org/previews/640/640204_12131847-hq.mp3    fs-640204-metal-thud-dirt.mp3    # 7of9Designs, Heavy Metal Thud on Ground
fetch https://cdn.freesound.org/previews/569/569555_9250976-hq.mp3     fs-569555-impact-metal.mp3       # Nox_Sound, Foley_Impact_Metal_Long_Mono
fetch https://cdn.freesound.org/previews/353/353907_5984825-hq.mp3     fs-353907-shovel-dirt.mp3        # dr19, Shovel_dirt
fetch https://cdn.freesound.org/previews/384/384362_984733-hq.mp3      fs-384362-digging-soil.mp3       # Ali_6868, Digging a Hole and Shovelling Soil/Dirt 2
# Kenney, Impact Sounds 1.0 (CC0), https://kenney.nl/assets/impact-sounds
fetch https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip kenney_impact-sounds.zip
K="$DL/kenney-impact"
if [ ! -d "$K" ]; then
  mkdir -p "$K"
  unzip -q -j -o "$DL/kenney_impact-sounds.zip" "Audio/*" "License.txt" -d "$K"
fi

# ------------------------------------------------------------ clips
# measure <wav> <seconds>: "<RMS dB> <peak dB>" of its first <seconds> / of the whole file
measure() {
  local rms peak
  rms=$(ffmpeg -v info -nostats -i "$1" -af "atrim=0:$2,astats=measure_overall=RMS_level:measure_perchannel=none" -f null - 2>&1 \
    | awk '/RMS level dB/ {v = $NF} END {print v}')
  peak=$(ffmpeg -v info -nostats -i "$1" -af "astats=measure_overall=Peak_level:measure_perchannel=none" -f null - 2>&1 \
    | awk '/Peak level dB/ {v = $NF} END {print v}')
  echo "$rms $peak"
}

# finish <name> <wav> <target RMS dB>: level it and encode src/sounds/recorded/<name>.mp3
LIMIT="alimiter=limit=0.84:attack=2:release=60:level=false:latency=true"
finish() {
  local gain g2
  gain=$(measure "$2" 0.25 | awk -v t="$3" '{print t - $1}')
  ffmpeg -v error -y -i "$2" -af "volume=${gain}dB,$LIMIT" -c:a pcm_f32le "$TMP/pass1.wav"
  g2=$(measure "$TMP/pass1.wav" 0.25 | awk -v t="$3" -v g="$gain" '{print g + t - $1}')
  ffmpeg -v error -y -i "$2" -af "volume=${g2}dB,$LIMIT" -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k \
    -map_metadata -1 -id3v2_version 0 -write_id3v1 0 "$OUT/$1.mp3"
}

# clip <name> <source> <start s> <length s> <fade-out s> <target RMS dB> [extra filters]
clip() {
  local f="$TMP/$1.wav" extra="${7:+,$7}"
  ffmpeg -v error -y -ss "$3" -t "$4" -i "$2" -ac 1 -ar 44100 \
    -af "highpass=f=35$extra,afade=t=in:d=0.004,afade=t=out:st=$(echo "$4 $5" | awk '{print $1 - $2}'):d=$5" -c:a pcm_f32le "$f"
  finish "$1" "$f" "$6"
}

# layered <name> <source A> <start A> <source B> <start B> <B gain dB> <length s> <fade-out s> <target RMS dB>:
# A with B under it (a metal clank over a thud)
layered() {
  local f="$TMP/$1.wav"
  ffmpeg -v error -y -ss "$3" -t "$7" -i "$2" -ss "$5" -t "$7" -i "$4" -filter_complex \
    "[0:a]aformat=sample_rates=44100:channel_layouts=mono[a];[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume=$6dB[b];\
[a][b]amix=inputs=2:duration=longest:normalize=0,highpass=f=35,afade=t=in:d=0.004,afade=t=out:st=$(echo "$7 $8" | awk '{print $1 - $2}'):d=$8" \
    -c:a pcm_f32le "$f"
  finish "$1" "$f" "$9"
}

rm -f "$OUT"/*.mp3
# fire: a cannon shot - the bang and a short part of its roll, faded out (shots can come every few frames)
clip fire-1    "$DL/fs-187767-cannon-shot.mp3"     0.14  0.85 0.5  -13
clip fire-2    "$DL/fs-187767-cannon-shot.mp3"     6.375 0.85 0.5  -13
clip fire-3    "$DL/fs-702455-6pdr-gun.mp3"        8.91  0.85 0.5  -13
# impact: the shell into dirt (a heavy thud into dirt) / rock (a pick on rock)
clip impact-1  "$DL/fs-640204-metal-thud-dirt.mp3" 0.15  0.45 0.2  -17
clip impact-2  "$K/impactMining_000.ogg"           0     0.3  0.15 -17
# hit: the shell on a tank - a metal clank with a thud under it
layered hit-1  "$DL/fs-569555-impact-metal.mp3" 0    "$K/impactPunch_heavy_000.ogg" 0 -4 0.6 0.3 -15
layered hit-2  "$DL/fs-569555-impact-metal.mp3" 3.14 "$K/impactPunch_heavy_001.ogg" 0 -4 0.6 0.3 -15
layered hit-3  "$K/impactPlate_heavy_000.ogg"   0    "$K/impactPunch_heavy_002.ogg" 0 -4 0.5 0.25 -15
# destroy: a tank blowing up - a big boom with its tail
clip destroy-1 "$DL/fs-182429-explosion.mp3"       0     1.9  0.6  -10
clip destroy-2 "$DL/fs-239137-artillery.mp3"       3.075 2.0  0.7  -10
# dig: one spade thrust into dirt each (short: it repeats while a tank digs)
clip dig-1     "$DL/fs-353907-shovel-dirt.mp3"     0.31  0.15 0.08 -23
clip dig-2     "$DL/fs-353907-shovel-dirt.mp3"     3.255 0.15 0.08 -23
clip dig-3     "$DL/fs-353907-shovel-dirt.mp3"     4.98  0.15 0.08 -23
clip dig-4     "$DL/fs-353907-shovel-dirt.mp3"     6.95  0.15 0.08 -23
clip dig-5     "$DL/fs-384362-digging-soil.mp3"    8.06  0.18 0.08 -23
# bump: tracks against rock - a dull heavy thud
clip bump-1    "$K/impactSoft_heavy_000.ogg"       0     0.4  0.2  -18
clip bump-2    "$K/impactSoft_heavy_002.ogg"       0     0.4  0.2  -18

# ------------------------------------------------------------ report
total=0
for f in "$OUT"/*.mp3; do
  ffmpeg -v error -y -i "$f" -c:a pcm_f32le "$TMP/check.wav"
  len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/check.wav")
  size=$(stat -c %s "$f"); total=$((total + size))
  printf "%-14s attack RMS / peak dB: %-16s %5.2f s %6d bytes\n" "$(basename "$f")" "$(measure "$TMP/check.wav" 0.25)" "$len" "$size"
done
echo "total $total bytes"
