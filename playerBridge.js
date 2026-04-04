var lastPlayerTime = 0;
var lastPlayerTimestamp = 0;
var lastSentPlaying = null;
var pausedTickCounter = 0;
var tickInterval = null;

function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(function () {
    var player = document.getElementById("movie_player");
    if (!player) return;
    try {
      var now = Date.now();
      var data = player.getVideoData();
      var currentTime = player.getCurrentTime();
      var duration = player.getDuration();
      var state = player.getPlayerStateObject();
      var playing = state.isPlaying && !state.isBuffering;

      if (!playing) {
        pausedTickCounter++;
        var stateChanged = lastSentPlaying !== playing;
        var timeChanged = currentTime !== lastPlayerTime;
        if (!stateChanged && !timeChanged && pausedTickCounter < 25) return;
        pausedTickCounter = 0;
      }
      lastSentPlaying = playing;

      if (currentTime !== lastPlayerTime || !playing) {
        lastPlayerTime = currentTime;
        lastPlayerTimestamp = now;
      }

      var timeDiff = (now - lastPlayerTimestamp) / 1000;
      var time = playing ? currentTime + timeDiff : currentTime;

      window.postMessage({
        type: "aml-player-tick",
        currentTime: time,
        videoId: data.video_id,
        song: data.title,
        artist: data.author,
        duration: duration,
        playing: playing
      }, "*");
    } catch (e) { }
  }, 20);
}

window.addEventListener("message", function (e) {
  if (!e.data || e.data.type !== "aml-seek-to") return;
  var player = document.getElementById("movie_player");
  if (player && e.data.time >= 0) {
    player.seekTo(e.data.time, true);
    player.playVideo();
  }
});

startTick();
