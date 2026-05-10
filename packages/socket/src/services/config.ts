import { QuizzWithId } from "@rahoot/common/types/game";
import type { QuizzInput } from "@rahoot/common/validators/quizz";
import fs from "fs";
import { resolve } from "path";

const inContainerPath = process.env.CONFIG_PATH;

const getPath = (path: string = "") =>
  inContainerPath
    ? resolve(inContainerPath, path)
    : resolve(process.cwd(), "../../config", path);

class Config {
  private static toFileId(input: string) {
    return input
      .toLowerCase()
      .trim()
      .replace(/\.json$/i, "")
      .replace(/[^a-z0-9-_]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  static init() {
    const isConfigFolderExists = fs.existsSync(getPath());

    if (!isConfigFolderExists) {
      fs.mkdirSync(getPath());
    }

    const isGameConfigExists = fs.existsSync(getPath("game.json"));

    if (!isGameConfigExists) {
      fs.writeFileSync(
        getPath("game.json"),
        JSON.stringify(
          {
            managerPassword: "PASSWORD",
            managerEmails: [],
            music: true,
          },
          null,
          2,
        ),
      );
    }

    const isQuizzExists = fs.existsSync(getPath("quizz"));

    if (!isQuizzExists) {
      fs.mkdirSync(getPath("quizz"));

      fs.writeFileSync(
        getPath("quizz/example.json"),
        JSON.stringify(
          {
            subject: "Example Quizz",
            questions: [
              {
                question: "What is good answer ?",
                answers: ["No", "Good answer", "No", "No"],
                solution: 1,
                cooldown: 5,
                time: 15,
              },
              {
                question: "What is good answer with image ?",
                answers: ["No", "No", "No", "Good answer"],
                image: "https://placehold.co/600x400.png",
                solution: 3,
                cooldown: 5,
                time: 20,
              },
              {
                question: "What is good answer with two answers ?",
                answers: ["Good answer", "No"],
                image: "https://placehold.co/600x400.png",
                solution: 0,
                cooldown: 5,
                time: 20,
              },
            ],
          },
          null,
          2,
        ),
      );
    }
  }

  static game() {
    const isExists = fs.existsSync(getPath("game.json"));

    if (!isExists) {
      throw new Error("Game config not found");
    }

    try {
      const config = fs.readFileSync(getPath("game.json"), "utf-8");

      return JSON.parse(config);
    } catch (error) {
      console.error("Failed to read game config:", error);
    }

    return {};
  }

  static quizz() {
    const isExists = fs.existsSync(getPath("quizz"));

    if (!isExists) {
      return [];
    }

    try {
      const files = fs
        .readdirSync(getPath("quizz"))
        .filter((file) => file.endsWith(".json"));

      const quizz: QuizzWithId[] = files.map((file) => {
        const data = fs.readFileSync(getPath(`quizz/${file}`), "utf-8");
        const config = JSON.parse(data);

        const id = file.replace(".json", "");

        return {
          id,
          ...config,
        };
      });

      return quizz || [];
    } catch (error) {
      console.error("Failed to read quizz config:", error);

      return [];
    }
  }

  static importQuizz(fileName: string, quizz: QuizzInput) {
    const quizzFolderPath = getPath("quizz");

    if (!fs.existsSync(quizzFolderPath)) {
      fs.mkdirSync(quizzFolderPath, { recursive: true });
    }

    const fileNameId = this.toFileId(fileName);
    const subjectId = this.toFileId(quizz.subject);

    const baseId = fileNameId || subjectId || `quizz_${Date.now()}`;

    let quizzId = baseId;
    let suffix = 1;

    while (fs.existsSync(getPath(`quizz/${quizzId}.json`))) {
      quizzId = `${baseId}_${suffix}`;
      suffix += 1;
    }

    fs.writeFileSync(
      getPath(`quizz/${quizzId}.json`),
      JSON.stringify(quizz, null, 2),
    );

    return quizzId;
  }
}

export default Config;
