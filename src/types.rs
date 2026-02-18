use serde::{Deserialize, Serialize};

/// A player in a game session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: String,
    pub client_id: String,
    pub connected: bool,
    pub username: String,
    pub points: f64,
}

/// A recorded answer from a player.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Answer {
    pub player_id: String,
    pub answer_id: usize,
    pub points: f64,
}

/// A single question in a quiz.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub question: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub video: Option<String>,
    #[serde(default)]
    pub audio: Option<String>,
    #[serde(default, rename = "answer-image")]
    pub answer_image: Option<String>,
    pub answers: Vec<String>,
    pub solution: usize,
    pub cooldown: u64,
    pub time: u64,
}

/// A quiz definition loaded from config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quiz {
    pub subject: String,
    pub questions: Vec<Question>,
}

/// A quiz with its file-based id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizWithId {
    pub id: String,
    #[serde(flatten)]
    pub quiz: Quiz,
}

/// Game configuration loaded from game.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameConfig {
    #[serde(rename = "managerPassword")]
    pub manager_password: String,
    #[serde(rename = "managerEmails", default)]
    pub manager_emails: Vec<String>,
}

/// Current question progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionProgress {
    pub current: usize,
    pub total: usize,
}

/// All possible game states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameStatus {
    ShowRoom,
    ShowStart,
    ShowPrepared,
    ShowQuestion,
    SelectAnswer,
    ShowResult,
    ShowResponses,
    ShowLeaderboard,
    Finished,
    Wait,
}

impl std::fmt::Display for GameStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ShowRoom => write!(f, "SHOW_ROOM"),
            Self::ShowStart => write!(f, "SHOW_START"),
            Self::ShowPrepared => write!(f, "SHOW_PREPARED"),
            Self::ShowQuestion => write!(f, "SHOW_QUESTION"),
            Self::SelectAnswer => write!(f, "SELECT_ANSWER"),
            Self::ShowResult => write!(f, "SHOW_RESULT"),
            Self::ShowResponses => write!(f, "SHOW_RESPONSES"),
            Self::ShowLeaderboard => write!(f, "SHOW_LEADERBOARD"),
            Self::Finished => write!(f, "FINISHED"),
            Self::Wait => write!(f, "WAIT"),
        }
    }
}

/// Messages sent from server to clients via WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMsg {
    // Status updates
    GameStatus {
        status: GameStatus,
        data: serde_json::Value,
    },
    SuccessRoom {
        game_id: String,
    },
    SuccessJoin {
        game_id: String,
    },
    TotalPlayers {
        count: usize,
    },
    ErrorMessage {
        message: String,
    },
    StartCooldown,
    Cooldown {
        count: u64,
    },
    Reset {
        message: String,
    },
    UpdateQuestion {
        current: usize,
        total: usize,
    },
    PlayerAnswer {
        count: usize,
    },

    // Manager-specific
    QuizList {
        quizzes: Vec<QuizWithId>,
    },
    GameCreated {
        game_id: String,
        invite_code: String,
    },
    ManagerReconnected {
        game_id: String,
        status: GameStatus,
        data: serde_json::Value,
        players: Vec<Player>,
        current_question: QuestionProgress,
    },
    NewPlayer {
        player: Player,
    },
    RemovePlayer {
        player_id: String,
    },
    PlayerKicked {
        player_id: String,
    },

    // Player-specific
    PlayerReconnected {
        game_id: String,
        status: GameStatus,
        data: serde_json::Value,
        username: String,
        points: f64,
        current_question: QuestionProgress,
    },
    UpdateLeaderboard {
        leaderboard: Vec<Player>,
    },
}

/// Messages sent from clients to server via WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMsg {
    // Manager auth
    ManagerAuth { password: String },
    // Game creation
    CreateGame { quiz_id: String },
    // Manager actions
    ManagerReconnect { game_id: String },
    StartGame { game_id: String },
    AbortQuiz { game_id: String },
    NextQuestion { game_id: String },
    ShowLeaderboard { game_id: String },
    KickPlayer { game_id: String, player_id: String },

    // Player actions
    PlayerJoin { invite_code: String },
    PlayerLogin { game_id: String, username: String },
    PlayerReconnect { game_id: String },
    SelectedAnswer { game_id: String, answer_key: usize },
}
