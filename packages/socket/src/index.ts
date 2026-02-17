import { Server } from "@rahoot/common/types/game/socket";
import { inviteCodeValidator } from "@rahoot/common/validators/auth";
import env from "@rahoot/socket/env";
import Config from "@rahoot/socket/services/config";
import Game from "@rahoot/socket/services/game";
import Registry from "@rahoot/socket/services/registry";
import { withGame } from "@rahoot/socket/utils/game";
import fs from "fs";
import { OAuth2Client } from "google-auth-library";
import { createServer } from "http";
import { extname, resolve } from "path";
import { Server as ServerIO } from "socket.io";

const inContainerPath = process.env.CONFIG_PATH;
const getConfigPath = (path: string = "") =>
  inContainerPath
    ? resolve(inContainerPath, path)
    : resolve(process.cwd(), "../../config", path);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const httpServer = createServer((req, res) => {
  // Handle CORS
  res.setHeader("Access-Control-Allow-Origin", env.WEB_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve images from /images/* path
  if (req.url?.startsWith("/images/")) {
    const imagePath = req.url.replace("/images/", "");
    const fullPath = getConfigPath(`quizz/images/${imagePath}`);

    // Security: prevent path traversal
    if (imagePath.includes("..")) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const ext = extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext];

    if (!mimeType) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.writeHead(200);
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const io: Server = new ServerIO(httpServer, {
  cors: {
    origin: [env.WEB_ORIGIN],
  },
});
Config.init();

const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null;

const registry = Registry.getInstance();
const port = 3001;

console.log(`Socket server running on port ${port}`);
httpServer.listen(port);

io.on("connection", (socket) => {
  console.log(
    `A user connected: socketId: ${socket.id}, clientId: ${socket.handshake.auth.clientId}`,
  );

  socket.on("player:reconnect", ({ gameId }) => {
    const game = registry.getPlayerGame(gameId, socket.handshake.auth.clientId);

    if (game) {
      game.reconnect(socket);

      return;
    }

    socket.emit("game:reset", "Game not found");
  });

  socket.on("manager:reconnect", ({ gameId }) => {
    const game = registry.getManagerGame(
      gameId,
      socket.handshake.auth.clientId,
    );

    if (game) {
      game.reconnect(socket);

      return;
    }

    socket.emit("game:reset", "Game expired");
  });

  socket.on("manager:auth", (password) => {
    try {
      const config = Config.game();

      if (password !== config.managerPassword) {
        socket.emit("manager:errorMessage", "Invalid password");

        return;
      }

      socket.emit("manager:quizzList", Config.quizz());
    } catch (error) {
      console.error("Failed to read game config:", error);
      socket.emit("manager:errorMessage", "Failed to read game config");
    }
  });

  socket.on("manager:googleAuth", async (credential) => {
    try {
      if (!googleClient || !env.GOOGLE_CLIENT_ID) {
        socket.emit("manager:errorMessage", "Google Sign-In is not configured");

        return;
      }

      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      if (!payload?.email) {
        socket.emit("manager:errorMessage", "Unable to verify Google account");

        return;
      }

      const config = Config.game();
      const managerEmails: string[] = config.managerEmails || [];

      if (managerEmails.length > 0 && !managerEmails.includes(payload.email)) {
        socket.emit("manager:errorMessage", "Unauthorized email address");

        return;
      }

      socket.emit("manager:quizzList", Config.quizz());
    } catch (error) {
      console.error("Google auth failed:", error);
      socket.emit("manager:errorMessage", "Google authentication failed");
    }
  });

  socket.on("game:create", (quizzId) => {
    const quizzList = Config.quizz();
    const quizz = quizzList.find((q) => q.id === quizzId);

    if (!quizz) {
      socket.emit("game:errorMessage", "Quizz not found");

      return;
    }

    const game = new Game(io, socket, quizz);
    registry.addGame(game);
  });

  socket.on("player:join", (inviteCode) => {
    const result = inviteCodeValidator.safeParse(inviteCode);

    if (result.error) {
      socket.emit("game:errorMessage", result.error.issues[0].message);

      return;
    }

    const game = registry.getGameByInviteCode(inviteCode);

    if (!game) {
      socket.emit("game:errorMessage", "Game not found");

      return;
    }

    socket.emit("game:successRoom", game.gameId);
  });

  socket.on("player:login", ({ gameId, data }) =>
    withGame(gameId, socket, (game) => game.join(socket, data.username)),
  );

  socket.on("manager:kickPlayer", ({ gameId, playerId }) =>
    withGame(gameId, socket, (game) => game.kickPlayer(socket, playerId)),
  );

  socket.on("manager:startGame", ({ gameId }) =>
    withGame(gameId, socket, (game) => game.start(socket)),
  );

  socket.on("player:selectedAnswer", ({ gameId, data }) =>
    withGame(gameId, socket, (game) =>
      game.selectAnswer(socket, data.answerKey),
    ),
  );

  socket.on("manager:abortQuiz", ({ gameId }) =>
    withGame(gameId, socket, (game) => game.abortRound(socket)),
  );

  socket.on("manager:nextQuestion", ({ gameId }) =>
    withGame(gameId, socket, (game) => game.nextRound(socket)),
  );

  socket.on("manager:showLeaderboard", ({ gameId }) =>
    withGame(gameId, socket, (game) => game.showLeaderboard()),
  );

  socket.on("disconnect", () => {
    console.log(`A user disconnected : ${socket.id}`);

    const managerGame = registry.getGameByManagerSocketId(socket.id);

    if (managerGame) {
      managerGame.manager.connected = false;
      registry.markGameAsEmpty(managerGame);

      if (!managerGame.started) {
        console.log("Reset game (manager disconnected)");
        managerGame.abortCooldown();
        io.to(managerGame.gameId).emit("game:reset", "Manager disconnected");
        registry.removeGame(managerGame.gameId);

        return;
      }
    }

    const game = registry.getGameByPlayerSocketId(socket.id);

    if (!game) {
      return;
    }

    const player = game.players.find((p) => p.id === socket.id);

    if (!player) {
      return;
    }

    if (!game.started) {
      game.players = game.players.filter((p) => p.id !== socket.id);

      io.to(game.manager.id).emit("manager:removePlayer", player.id);
      io.to(game.gameId).emit("game:totalPlayers", game.players.length);

      console.log(`Removed player ${player.username} from game ${game.gameId}`);

      return;
    }

    player.connected = false;
    io.to(game.gameId).emit("game:totalPlayers", game.players.length);
  });
});

process.on("SIGINT", () => {
  Registry.getInstance().cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  Registry.getInstance().cleanup();
  process.exit(0);
});
