// plugins/cargame.js
// WhatsApp In-Chat Car Game (Fixed Compatibility Version + Cyber Arcade UI)

'use strict';

const { randomUUID } = require('crypto');

/* =========================================================
 * GENAI GAME HTML PAYLOAD (Optimized for WA Webview)
 * ========================================================= */
function createCarGameHTML() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <style>
        * { box-sizing: border-box; user-select: none; -webkit-tap-highlight-color: transparent; }
        body {
          margin: 0; padding: 0; background: #0b0f1a; color: white;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          overflow: hidden;
        }

        #frame {
          position: relative; max-width: 400px; margin: 14px auto 0;
          background: #0d1420;
          border: 2px solid #22e5ff;
          border-radius: 20px;
          padding: 22px 14px 14px;
        }

        #frame-tag {
          position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
          background: #0b0f1a; border: 1px solid #22e5ff; color: #22e5ff;
          font-size: 10px; font-weight: bold; letter-spacing: 2px;
          padding: 3px 14px; border-radius: 20px; white-space: nowrap;
        }

        #header-row {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 10px;
        }
        #label { color: #22e5ff; font-size: 11px; font-weight: bold; letter-spacing: 2px; }
        #title { color: white; font-size: 20px; font-weight: bold; margin-top: 2px; }

        #score-pill {
          background: rgba(255,79,158,0.15); border: 1px solid #ff4f9e; color: #ff4f9e;
          font-size: 12px; font-weight: bold; padding: 6px 12px; border-radius: 14px;
          white-space: nowrap;
        }

        /* Fixed height is much safer for WhatsApp WebViews instead of 100vh */
        #game-container {
          position: relative; width: 100%; height: 440px;
          background: #1b2436;
          border-radius: 14px;
          overflow: hidden;
        }

        .road-line {
          position: absolute; width: 5px; height: 38px; background: rgba(255,255,255,0.35);
          border-radius: 2px;
        }
        .lane-16 { left: 16.6%; margin-left: -2px; }
        .lane-50 { left: 50%; margin-left: -2px; }
        .lane-83 { left: 83.3%; margin-left: -2px; }

        .car {
          position: absolute; bottom: 90px; width: 40px; height: 68px;
          border-radius: 10px; transition: left 0.15s ease-out; z-index: 5;
          transform: translateX(-50%);
        }
        .car .window {
          position: absolute; top: 14px; left: 6px; right: 6px; height: 16px;
          background: rgba(255,255,255,0.55); border-radius: 4px;
        }
        #player { background: #22e5ff; }
        .enemy-red { background: #ff4d4d; }
        .enemy-green { background: #33cc66; }
        .enemy-orange { background: #ff9f2e; }

        #controls {
          display: flex; gap: 10px; margin-top: 12px;
        }
        .ctrl-btn {
          flex: 1; padding: 16px 0; border: none; border-radius: 12px;
          font-size: 16px; font-weight: bold; color: white;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        #btn-left { background: #2f6bff; }
        #btn-right { background: #ff2f8f; }
        .ctrl-btn:active { opacity: 0.8; }

        #start-screen, #game-over {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(11,15,26,0.95);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          z-index: 20; text-align: center; padding: 20px;
        }
        #game-over { display: none; }

        .hero-car { width: 42px; height: 74px; margin-bottom: 16px; background: #22e5ff; border-radius: 10px; position: relative; }
        .hero-car .window { position: absolute; top: 15px; left: 6px; right: 6px; height: 17px; background: rgba(255,255,255,0.55); border-radius: 4px; }

        h1 { color: #22e5ff; margin: 0 0 6px; font-size: 26px; letter-spacing: 1px; }
        #game-over h1 { color: #ff4f9e; }
        p.tagline { font-size: 14px; margin: 0 0 24px; color: #8ea0b8; }

        .final-pill {
          font-size: 14px; font-weight: bold; color: #ff4f9e;
          background: rgba(255,79,158,0.12); border: 1px solid #ff4f9e;
          padding: 8px 20px; border-radius: 18px; margin-bottom: 22px;
        }

        .action-btn {
          background: #22e5ff; border: none; padding: 12px 30px;
          border-radius: 22px; color: #0b0f1a; font-size: 15px; font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div id="frame">
        <div id="frame-tag">VORTEX ARCADE</div>
        <div id="header-row">
          <div>
            <div id="label">CYBER ARCADE</div>
            <div id="title">Highway Rush 🏎️</div>
          </div>
          <div id="score-pill">SCORE: <span id="score">0</span></div>
        </div>

        <div id="game-container">
          <div id="player" class="car"><div class="window"></div></div>

          <div id="start-screen">
            <div class="hero-car"><div class="window"></div></div>
            <h1>VORTEX RACER</h1>
            <p class="tagline">Dodge traffic. Chase the high score.</p>
            <button class="action-btn" id="start-btn">START GAME</button>
          </div>

          <div id="game-over">
            <h1>CRASHED!</h1>
            <div class="final-pill">Final Score: <span id="final-score">0</span></div>
            <button class="action-btn" id="restart-btn">PLAY AGAIN</button>
          </div>
        </div>

        <div id="controls">
          <button class="ctrl-btn" id="btn-left">⬅ LEFT</button>
          <button class="ctrl-btn" id="btn-right">RIGHT ➡</button>
        </div>
      </div>

      <script>
        // --- Safe Audio Wrapper (Prevents crashing if WA blocks audio) ---
        let audioCtx = null;
        function initAudio() {
          try {
            if (!audioCtx) {
              const AudioContext = window.AudioContext || window.webkitAudioContext;
              if (AudioContext) audioCtx = new AudioContext();
            }
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
          } catch(e) { console.log('Audio not supported'); }
        }

        function playTone(freq, type, duration) {
          if(!audioCtx) return;
          try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
          } catch(e){}
        }

        function playCrash() {
          if(!audioCtx) return;
          try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.5);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.5);
          } catch(e){}
        }

        // --- Game Logic ---
        const container = document.getElementById('game-container');
        const player = document.getElementById('player');
        const scoreEl = document.getElementById('score');
        const gameOverScreen = document.getElementById('game-over');
        const startScreen = document.getElementById('start-screen');
        const finalScoreEl = document.getElementById('final-score');

        let score = 0, speed = 4;
        let gameLoop, enemySpawner, lineSpawner;
        let isGameOver = true;

        // Use percentages for lanes so it works on any screen size safely
        const lanes = ['16.6%', '50%', '83.3%'];
        const laneClasses = ['lane-16', 'lane-50', 'lane-83'];
        const enemyColors = ['enemy-red', 'enemy-green', 'enemy-orange'];
        let currentLane = 1;

        function updatePlayerPosition() {
          player.style.left = lanes[currentLane];
        }

        function moveLeft(e) {
          if(e) e.preventDefault();
          if (currentLane > 0) { currentLane--; playTone(600, 'sine', 0.1); }
          updatePlayerPosition();
        }

        function moveRight(e) {
          if(e) e.preventDefault();
          if (currentLane < 2) { currentLane++; playTone(600, 'sine', 0.1); }
          updatePlayerPosition();
        }

        document.getElementById('btn-left').addEventListener('touchstart', moveLeft);
        document.getElementById('btn-left').addEventListener('mousedown', moveLeft);
        document.getElementById('btn-right').addEventListener('touchstart', moveRight);
        document.getElementById('btn-right').addEventListener('mousedown', moveRight);

        document.getElementById('start-btn').addEventListener('click', () => { initAudio(); startGame(); });
        document.getElementById('restart-btn').addEventListener('click', () => { initAudio(); startGame(); });

        function spawnEnemy() {
          if (isGameOver) return;
          const laneIndex = Math.floor(Math.random() * 3);
          const color = enemyColors[Math.floor(Math.random() * enemyColors.length)];
          const enemy = document.createElement('div');
          enemy.className = 'car ' + color;
          enemy.style.left = lanes[laneIndex];
          enemy.style.top = '-80px';
          const win = document.createElement('div');
          win.className = 'window';
          enemy.appendChild(win);
          container.appendChild(enemy);
        }

        function spawnRoadLine() {
          if (isGameOver) return;
          const laneIndex = Math.floor(Math.random() * 3);
          const line = document.createElement('div');
          line.className = 'road-line ' + laneClasses[laneIndex];
          line.style.top = '-40px';
          container.appendChild(line);
        }

        function checkCollision(enemyRect, playerRect) {
          return !( playerRect.top > enemyRect.bottom - 5 ||
                    playerRect.bottom < enemyRect.top + 5 ||
                    playerRect.left > enemyRect.right - 5 ||
                    playerRect.right < enemyRect.left + 5 );
        }

        function update() {
          if (isGameOver) return;
          const playerRect = player.getBoundingClientRect();
          const gameHeight = container.clientHeight || 440;

          document.querySelectorAll('.car:not(#player)').forEach(enemy => {
            let top = parseFloat(enemy.style.top);
            if (top > gameHeight) {
              enemy.remove();
              score += 10;
              scoreEl.innerText = score;
              if (score > 0 && score % 100 === 0) {
                speed += 0.8;
                playTone(600, 'square', 0.1);
              }
            } else {
              enemy.style.top = (top + speed) + 'px';
              if (checkCollision(enemy.getBoundingClientRect(), playerRect)) endGame();
            }
          });

          document.querySelectorAll('.road-line').forEach(line => {
            let top = parseFloat(line.style.top);
            if (top > gameHeight) line.remove();
            else line.style.top = (top + speed * 1.5) + 'px';
          });

          gameLoop = requestAnimationFrame(update);
        }

        function endGame() {
          isGameOver = true;
          playCrash();
          cancelAnimationFrame(gameLoop);
          clearInterval(enemySpawner);
          clearInterval(lineSpawner);
          finalScoreEl.innerText = score;
          gameOverScreen.style.display = 'flex';
        }

        function startGame() {
          isGameOver = false;
          score = 0; speed = 4; currentLane = 1;
          scoreEl.innerText = score;
          updatePlayerPosition();
          startScreen.style.display = 'none';
          gameOverScreen.style.display = 'none';

          document.querySelectorAll('.car:not(#player), .road-line').forEach(el => el.remove());

          enemySpawner = setInterval(spawnEnemy, 1200);
          lineSpawner = setInterval(spawnRoadLine, 250);
          update();
        }
      </script>
    </body>
    </html>
  `;
}

/* =========================================================
 * MESSAGE SENDER
 * ========================================================= */
async function sendCarGame(socket, targetJid) {
  const responseId = randomUUID();
  const gameHTML = createCarGameHTML();

  await socket.relayMessage(
    targetJid,
    {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
        botMetadata: {
          messageDisclaimerText: '',
          botResponseId: responseId
        }
      },
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              {
                messageType: 2,
                messageText: 'VORTEX RACER GAME'
              }
            ],
            unifiedResponse: {
              data: Buffer.from(
                JSON.stringify({
                  response_id: responseId,
                  sections: [
                    {
                      view_model: {
                        primitive: {
                          __typename: 'GenAIaeacdsnwHtmlPrimitive',
                          payload: gameHTML,
                          trusted_sources: []
                        },
                        __typename: 'GenAISingleLayoutViewModel'
                      }
                    }
                  ]
                })
              ).toString('base64')
            },
            contextInfo: {
              forwardingScore: 1,
              isForwarded: true,
              forwardedAiBotMessageInfo: {
                botJid: '867051314767696@bot' // Replace with your actual bot JID if needed
              },
              forwardOrigin: 4
            }
          }
        }
      }
    },
    { messageId: responseId }
  );
}

/* =========================================================
 * COMMAND HANDLER (.car)
 * ========================================================= */
async function handleCarCommand(socket, msg) {
  const sender = msg.key.remoteJid;

  await socket.sendMessage(sender, { react: { text: '🎮', key: msg.key } });

  try {
    await sendCarGame(socket, sender);
    await socket.sendMessage(sender, { react: { text: '🏎️', key: msg.key } });
  } catch (error) {
    console.error('[CAR GAME ERROR]', error);
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
}

module.exports = {
  handleCarCommand
};
