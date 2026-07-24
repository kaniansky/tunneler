"use strict"

// the form is a real POST to /create - server.js slugifies the name (or picks a random
// one if left blank), creates the session (if it doesn't already exist) and redirects to
// /<id>/. Nothing left to do here.

const play = document.location.origin + "/play";
document.querySelector("#play").href = play;
document.querySelector("#play").innerHTML = play;

for (const difficulty of ["easy", "medium", "hard"])
  document.querySelector("#ai" + difficulty[0].toUpperCase() + difficulty.slice(1)).href =
    document.location.origin + "/ai/" + difficulty;
