const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const file = path.join(__dirname, "public", "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("Erreur serveur");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// Chaque mot : [français, hébreu, anglais]
const PAIRS = [
  [["Foot", "כדורגל", "Soccer"], ["Basket", "כדורסל", "Basketball"]],
  [["Chat", "חתול", "Cat"], ["Chien", "כלב", "Dog"]],
  [["Pizza", "פיצה", "Pizza"], ["Burger", "המבורגר", "Burger"]],
  [["Plage", "חוף", "Beach"], ["Piscine", "בריכה", "Pool"]],
  [["Café", "קפה", "Coffee"], ["Thé", "תה", "Tea"]],
  [["Voiture", "מכונית", "Car"], ["Moto", "אופנוע", "Motorbike"]],
  [["Avion", "מטוס", "Plane"], ["Hélicoptère", "מסוק", "Helicopter"]],
  [["Pomme", "תפוח", "Apple"], ["Poire", "אגס", "Pear"]],
  [["Lune", "ירח", "Moon"], ["Soleil", "שמש", "Sun"]],
  [["Guitare", "גיטרה", "Guitar"], ["Violon", "כינור", "Violin"]],
  [["Cinéma", "קולנוע", "Cinema"], ["Théâtre", "תיאטרון", "Theater"]],
  [["Hiver", "חורף", "Winter"], ["Automne", "סתיו", "Autumn"]],
  [["Lion", "אריה", "Lion"], ["Tigre", "נמר", "Tiger"]],
  [["Montagne", "הר", "Mountain"], ["Colline", "גבעה", "Hill"]],
  [["Fraise", "תות", "Strawberry"], ["Framboise", "פטל", "Raspberry"]],
  [["Train", "רכבת", "Train"], ["Métro", "metro", "Subway"]],
  [["Pluie", "גשם", "Rain"], ["Neige", "שלג", "Snow"]],
  [["Chocolat", "שוקולד", "Chocolate"], ["Caramel", "קרמל", "Caramel"]],
  [["Ordinateur", "מחשב", "Computer"], ["Tablette", "טאבלט", "Tablet"]],
  [["Mer", "ים", "Sea"], ["Lac", "אגם", "Lake"]],
  [["Pirate", "פיראט", "Pirate"], ["Voleur", "גנב", "Thief"]],
  [["Château", "טירה", "Castle"], ["Palais", "ארמון", "Palace"]],
  [["Vampire", "ערפד", "Vampire"], ["Zombie", "זומבי", "Zombie"]],
  [["Sushi", "סושי", "Sushi"], ["Raviolis", "רביולי", "Ravioli"]],
];

const rooms = {};

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms[code]);
  return code;
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(room) {
  for (const p of room.players) {
    send(p.ws, stateFor(room, p));
  }
}

function stateFor(room, me) {
  return {
    type: "state",
    code: room.code,
    phase: room.phase,
    youId: me.id,
    hostId: room.hostId,
    myWord: room.phase !== "lobby" ? me.word : null,
    turnIndex: room.turnIndex,
    round: room.round,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      clues: p.clues,
      voted: room.votes[p.id] !== undefined,
      word: room.phase === "result" ? p.word : undefined,
      isImpostor: room.phase === "result" ? p.isImpostor : undefined,
    })),
    myVote: room.votes[me.id] || null,
    result: room.phase === "result" ? room.result : null,
  };
}

function startGame(room) {
  const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
  const flip = Math.random() < 0.5;
  const common = flip ? pair[0] : pair[1];
  const odd = flip ? pair[1] : pair[0];
  const impostorIdx = Math.floor(Math.random() * room.players.length);
  room.players.forEach((p, i) => {
    p.isImpostor = i === impostorIdx;
    p.word = p.isImpostor ? odd : common; // tableau [fr, he, en]
    p.clues = [];
  });
  room.votes = {};
  room.result = null;
  room.round = 1;
  room.turnIndex = 0;
  room.phase = "clues";
}

function endVoting(room) {
  const tally = {};
  Object.values(room.votes).forEach((id) => (tally[id] = (tally[id] || 0) + 1));
  let max = 0;
  let accusedIds = [];
  for (const id in tally) {
    if (tally[id] > max) {
      max = tally[id];
      accusedIds = [id];
    } else if (tally[id] === max) {
      accusedIds.push(id);
    }
  }
  const impostor = room.players.find((p) => p.isImpostor);
  const tie = accusedIds.length !== 1;
  const accused = tie ? null : room.players.find((p) => p.id === accusedIds[0]);
  room.result = {
    tie,
    accusedName: accused ? accused.name : null,
    impostorName: impostor.name,
    groupWins: !tie && !!accused && accused.isImpostor,
  };
  room.phase = "result";
}

function removePlayer(ws) {
  const code = ws.roomCode;
  const room = rooms[code];
  if (!room) return;
  const idx = room.players.findIndex((p) => p.ws === ws);
  if (idx === -1) return;
  const leaving = room.players[idx];
  room.players.splice(idx, 1);
  if (room.players.length === 0) {
    delete rooms[code];
    return;
  }
  if (room.hostId === leaving.id) room.hostId = room.players[0].id;
  if (room.phase !== "lobby" && room.players.length < 3) {
    room.phase = "lobby";
    room.votes = {};
    room.players.forEach((p) => (p.clues = []));
  } else if (room.phase === "clues") {
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
  } else if (room.phase === "voting") {
    delete room.votes[leaving.id];
    for (const k in room.votes) if (room.votes[k] === leaving.id) delete room.votes[k];
    if (Object.keys(room.votes).length === room.players.length) endVoting(room);
  }
  broadcast(room);
}

let nextId = 1;

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "create") {
      const name = String(msg.name || "").trim().slice(0, 16);
      if (!name) return send(ws, { type: "error", key: "needName" });
      const code = makeCode();
      const player = { id: String(nextId++), name, ws, clues: [] };
      rooms[code] = {
        code,
        hostId: player.id,
        players: [player],
        phase: "lobby",
        votes: {},
        turnIndex: 0,
        round: 1,
      };
      ws.roomCode = code;
      broadcast(rooms[code]);
      return;
    }

    if (msg.type === "join") {
      const name = String(msg.name || "").trim().slice(0, 16);
      const code = String(msg.code || "").trim().toUpperCase();
      if (!name) return send(ws, { type: "error", key: "needName" });
      const room = rooms[code];
      if (!room) return send(ws, { type: "error", key: "badCode" });
      if (room.phase !== "lobby") return send(ws, { type: "error", key: "started" });
      if (room.players.length >= 10) return send(ws, { type: "error", key: "full" });
      if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
        return send(ws, { type: "error", key: "nameTaken" });
      const player = { id: String(nextId++), name, ws, clues: [] };
      room.players.push(player);
      ws.roomCode = code;
      broadcast(room);
      return;
    }

    const room = rooms[ws.roomCode];
    if (!room) return;
    const me = room.players.find((p) => p.ws === ws);
    if (!me) return;

    if (msg.type === "start") {
      if (me.id !== room.hostId) return;
      if (room.players.length < 3) return send(ws, { type: "error", key: "min3" });
      startGame(room);
      broadcast(room);
    }

    if (msg.type === "clue" && room.phase === "clues") {
      if (room.players[room.turnIndex].id !== me.id) return;
      const word = String(msg.word || "").trim().slice(0, 24);
      if (!word) return;
      me.clues.push(word);
      room.turnIndex++;
      if (room.turnIndex >= room.players.length) {
        if (room.round >= 2) {
          room.phase = "voting";
        } else {
          room.round++;
          room.turnIndex = 0;
        }
      }
      broadcast(room);
    }

    if (msg.type === "vote" && room.phase === "voting") {
      if (room.votes[me.id] !== undefined) return;
      if (!room.players.some((p) => p.id === msg.target) || msg.target === me.id) return;
      room.votes[me.id] = msg.target;
      if (Object.keys(room.votes).length === room.players.length) endVoting(room);
      broadcast(room);
    }

    if (msg.type === "again") {
      if (me.id !== room.hostId) return;
      room.phase = "lobby";
      room.players.forEach((p) => (p.clues = []));
      room.votes = {};
      room.result = null;
      broadcast(room);
    }
  });

  ws.on("close", () => removePlayer(ws));
});

server.listen(PORT, () => console.log("Serveur sur le port " + PORT));
