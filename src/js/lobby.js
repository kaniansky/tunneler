"use strict"
// banner text is server-templated (see server.js's sendWithSessionName) - only the URL
// slug is needed here for building the player/spectator links
const sid = document.location.pathname.split("/").filter(Boolean)[0] || "";
const origin = document.location.origin;
const blue = origin + "/" + sid + "/blue";
const green = origin + "/" + sid + "/green";
const sp = origin + "/" + sid + "/spectate";

// spectate's password (if the session has one) is prompted for on the spectator page
// itself, not here - see spectator.js - so all three roles just navigate straight to
// their URL.
document.querySelector("#blue").addEventListener("click", () => document.location.href = blue);
document.querySelector("#green").addEventListener("click", () => document.location.href = green);
document.querySelector("#sp").addEventListener("click", () => document.location.href = sp);

// navigator.clipboard needs a secure context (https, or localhost) - fall back to the
// old select-and-execCommand trick over plain http so this still works there too.
async function copyText(text)
{
  if (navigator.clipboard)
    return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

const copyLinkBtn = document.querySelector("#copyLink");
copyLinkBtn.addEventListener("click", async () => {
  try
  {
    await copyText(document.location.href);
    const original = copyLinkBtn.textContent;
    copyLinkBtn.textContent = "Copied!";
    setTimeout(() => { copyLinkBtn.textContent = original; }, 1500);
  }
  catch (e)
  {
    console.log("Copy failed", e);
  }
});
