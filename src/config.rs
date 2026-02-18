use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{GameConfig, Quiz, QuizWithId};

/// Resolves a path relative to the config directory.
fn config_path(sub: &str) -> PathBuf {
    let base = std::env::var("CONFIG_PATH")
        .unwrap_or_else(|_| "config".to_string());
    Path::new(&base).join(sub)
}

/// Initialize config directory with defaults if missing.
pub fn init() {
    let base = config_path("");
    if !base.exists() {
        fs::create_dir_all(&base).expect("Failed to create config directory");
    }

    let game_path = config_path("game.json");
    if !game_path.exists() {
        let default_config = serde_json::json!({
            "managerPassword": "PASSWORD",
            "managerEmails": []
        });
        fs::write(&game_path, serde_json::to_string_pretty(&default_config).unwrap())
            .expect("Failed to write default game.json");
    }

    let quiz_dir = config_path("quizz");
    if !quiz_dir.exists() {
        fs::create_dir_all(&quiz_dir).expect("Failed to create quizz directory");

        let example = serde_json::json!({
            "subject": "Example Quiz",
            "questions": [
                {
                    "question": "What is the correct answer?",
                    "answers": ["No", "Correct", "No", "No"],
                    "solution": 1,
                    "cooldown": 5,
                    "time": 15
                }
            ]
        });
        fs::write(
            quiz_dir.join("example.json"),
            serde_json::to_string_pretty(&example).unwrap(),
        )
        .expect("Failed to write example quiz");
    }
}

/// Load the game configuration.
pub fn load_game_config() -> GameConfig {
    let path = config_path("game.json");
    let data = fs::read_to_string(&path).expect("Failed to read game.json");
    serde_json::from_str(&data).expect("Failed to parse game.json")
}

/// Load all quizzes from the quizz directory.
pub fn load_quizzes() -> Vec<QuizWithId> {
    let quiz_dir = config_path("quizz");
    if !quiz_dir.exists() {
        return vec![];
    }

    let mut quizzes = Vec::new();

    let entries = match fs::read_dir(&quiz_dir) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("Failed to read quizz directory: {}", e);
            return vec![];
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        match fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<Quiz>(&data) {
                Ok(quiz) => quizzes.push(QuizWithId { id, quiz }),
                Err(e) => tracing::error!("Failed to parse quiz {}: {}", path.display(), e),
            },
            Err(e) => tracing::error!("Failed to read quiz {}: {}", path.display(), e),
        }
    }

    quizzes
}

/// Resolve an image path to a full URL.
/// If already a full URL, returns as-is.
/// If a relative path (e.g. "images/..."), prepends the socket URL.
pub fn resolve_image_url(image_path: Option<&str>, socket_url: &str) -> Option<String> {
    image_path.map(|path| {
        if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}/{}", socket_url, path)
        }
    })
}
