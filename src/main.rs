mod config;
mod game;
mod types;

use std::collections::HashMap;
use std::sync::Arc;

use askama::Template;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use tokio::sync::Mutex;
use tower_http::services::ServeDir;

use crate::game::{GameCommand, GameEvent, GameHandle, Registry};
use crate::types::*;

#[derive(Clone)]
struct AppState {
    registry: Arc<Registry>,
    base_url: String,
    game_config: GameConfig,
    quizzes: Vec<QuizWithId>,
}

// ─── Templates ────────────────────────────────────────────────────

#[derive(Template)]
#[template(path = "index.html")]
struct IndexTemplate;

#[derive(Template)]
#[template(path = "manager.html")]
struct ManagerTemplate;

#[derive(Template)]
#[template(path = "game.html")]
struct GameTemplate {
    game_id: String,
    role: String,
}

// ─── Routes ───────────────────────────────────────────────────────

async fn index_page() -> impl IntoResponse {
    Html(IndexTemplate.to_string())
}

async fn manager_page() -> impl IntoResponse {
    Html(ManagerTemplate.to_string())
}

async fn game_page(Path(game_id): Path<String>, Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let role = params.get("role").cloned().unwrap_or_else(|| "player".to_string());
    Html(GameTemplate { game_id, role }.to_string())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let client_id = params.get("clientId").cloned().unwrap_or_default();
    ws.on_upgrade(move |socket| handle_socket(socket, state, client_id))
}

async fn handle_socket(socket: WebSocket, state: AppState, client_id: String) {
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));

    let socket_id = uuid::Uuid::new_v4().to_string();
    tracing::info!("WebSocket connected: {} client: {}", socket_id, client_id);

    // Track which game this socket is subscribed to for broadcasting
    let current_game: Arc<Mutex<Option<GameHandle>>> = Arc::new(Mutex::new(None));

    // Spawn a task that listens for game events and forwards to this socket
    let sender_clone = sender.clone();
    let socket_id_clone = socket_id.clone();
    let current_game_clone = current_game.clone();

    let event_task = tokio::spawn(async move {
        loop {
            let handle = {
                let guard = current_game_clone.lock().await;
                guard.clone()
            };

            let Some(handle) = handle else {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            };

            let mut event_rx = handle.event_tx.subscribe();

            loop {
                match event_rx.recv().await {
                    Ok(event) => {
                        let should_send = match &event {
                            GameEvent::SendTo { socket_id, .. } => *socket_id == socket_id_clone,
                            GameEvent::Broadcast { .. } => true,
                            GameEvent::BroadcastExcept { exclude, .. } => *exclude != socket_id_clone,
                            GameEvent::KickSocket { socket_id, .. } => *socket_id == socket_id_clone,
                        };

                        if should_send {
                            let msg = match &event {
                                GameEvent::SendTo { msg, .. }
                                | GameEvent::Broadcast { msg, .. }
                                | GameEvent::BroadcastExcept { msg, .. }
                                | GameEvent::KickSocket { msg, .. } => msg,
                            };

                            if let Ok(json) = serde_json::to_string(msg) {
                                let mut s = sender_clone.lock().await;
                                if s.send(Message::Text(json.into())).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        // Game ended, wait for potential new game
                        break;
                    }
                }
            }
        }
    });

    // Process incoming messages
    while let Some(Ok(msg)) = receiver.next().await {
        let Message::Text(text) = msg else { continue };

        let client_msg: ClientMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("Invalid message: {}", e);
                continue;
            }
        };

        match client_msg {
            ClientMsg::ManagerAuth { password } => {
                if password == state.game_config.manager_password {
                    let msg = ServerMsg::QuizList {
                        quizzes: state.quizzes.clone(),
                    };
                    send_msg(&sender, &msg).await;
                } else {
                    send_msg(&sender, &ServerMsg::ErrorMessage {
                        message: "Invalid password".to_string(),
                    }).await;
                }
            }

            ClientMsg::CreateGame { quiz_id } => {
                let quiz = state.quizzes.iter().find(|q| q.id == quiz_id);
                if let Some(quiz) = quiz {
                    let handle = game::create_game(
                        state.registry.clone(),
                        socket_id.clone(),
                        client_id.clone(),
                        quiz.quiz.clone(),
                        state.base_url.clone(),
                    );

                    send_msg(&sender, &ServerMsg::GameCreated {
                        game_id: handle.game_id.clone(),
                        invite_code: handle.invite_code.clone(),
                    }).await;

                    *current_game.lock().await = Some(handle);
                } else {
                    send_msg(&sender, &ServerMsg::ErrorMessage {
                        message: "Quiz not found".to_string(),
                    }).await;
                }
            }

            ClientMsg::PlayerJoin { invite_code } => {
                if invite_code.len() != 6 {
                    send_msg(&sender, &ServerMsg::ErrorMessage {
                        message: "Invalid invite code".to_string(),
                    }).await;
                    continue;
                }

                if let Some(game_id) = state.registry.invite_codes.get(&invite_code) {
                    if let Some(handle) = state.registry.games.get(game_id.value()) {
                        send_msg(&sender, &ServerMsg::SuccessRoom {
                            game_id: handle.game_id.clone(),
                        }).await;
                        *current_game.lock().await = Some(handle.clone());
                    } else {
                        send_msg(&sender, &ServerMsg::ErrorMessage {
                            message: "Game not found".to_string(),
                        }).await;
                    }
                } else {
                    send_msg(&sender, &ServerMsg::ErrorMessage {
                        message: "Game not found".to_string(),
                    }).await;
                }
            }

            ClientMsg::PlayerLogin { game_id, username } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::Join {
                        socket_id: socket_id.clone(),
                        client_id: client_id.clone(),
                        username,
                    }).await;
                    *current_game.lock().await = Some(handle.clone());
                }
            }

            ClientMsg::SelectedAnswer { game_id, answer_key } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::SelectAnswer {
                        socket_id: socket_id.clone(),
                        answer_key,
                    }).await;
                }
            }

            ClientMsg::StartGame { game_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::StartGame {
                        socket_id: socket_id.clone(),
                    }).await;
                }
            }

            ClientMsg::AbortQuiz { game_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::AbortQuiz {
                        socket_id: socket_id.clone(),
                    }).await;
                }
            }

            ClientMsg::NextQuestion { game_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::NextQuestion {
                        socket_id: socket_id.clone(),
                    }).await;
                }
            }

            ClientMsg::ShowLeaderboard { game_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::ShowLeaderboard {}).await;
                }
            }

            ClientMsg::KickPlayer { game_id, player_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::KickPlayer {
                        socket_id: socket_id.clone(),
                        player_id,
                    }).await;
                }
            }

            ClientMsg::PlayerReconnect { game_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::PlayerReconnect {
                        socket_id: socket_id.clone(),
                        client_id: client_id.clone(),
                    }).await;
                    *current_game.lock().await = Some(handle.clone());
                } else {
                    send_msg(&sender, &ServerMsg::Reset {
                        message: "Game not found".to_string(),
                    }).await;
                }
            }

            ClientMsg::ManagerReconnect { game_id } => {
                if let Some(handle) = state.registry.games.get(&game_id) {
                    let _ = handle.cmd_tx.send(GameCommand::ManagerReconnect {
                        socket_id: socket_id.clone(),
                        client_id: client_id.clone(),
                    }).await;
                    *current_game.lock().await = Some(handle.clone());
                } else {
                    send_msg(&sender, &ServerMsg::Reset {
                        message: "Game expired".to_string(),
                    }).await;
                }
            }
        }
    }

    // Socket disconnected
    tracing::info!("WebSocket disconnected: {}", socket_id);
    event_task.abort();

    // Notify the game about disconnect
    if let Some(game_id) = state.registry.manager_sockets.get(&socket_id) {
        if let Some(handle) = state.registry.games.get(game_id.value()) {
            let _ = handle.cmd_tx.send(GameCommand::ManagerDisconnect {
                socket_id: socket_id.clone(),
            }).await;
        }
    }

    if let Some(game_id) = state.registry.player_sockets.get(&socket_id) {
        if let Some(handle) = state.registry.games.get(game_id.value()) {
            let _ = handle.cmd_tx.send(GameCommand::PlayerDisconnect {
                socket_id: socket_id.clone(),
            }).await;
        }
    }
}

async fn send_msg(
    sender: &Arc<Mutex<SplitSink<WebSocket, Message>>>,
    msg: &ServerMsg,
) {
    if let Ok(json) = serde_json::to_string(msg) {
        let mut s = sender.lock().await;
        let _ = s.send(Message::Text(json.into())).await;
    }
}

// ─── Image serving from config ────────────────────────────────────

async fn serve_config_image(Path(path): Path<String>) -> impl IntoResponse {
    // Security: prevent path traversal
    if path.contains("..") {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let config_path = std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config".to_string());
    let full_path = std::path::Path::new(&config_path).join("quizz/images").join(&path);

    let ext = full_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    match tokio::fs::read(&full_path).await {
        Ok(data) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, mime),
             (axum::http::header::CACHE_CONTROL, "public, max-age=86400")],
            data,
        ).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── Main ─────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    config::init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()
        .expect("Invalid PORT");

    let base_url = std::env::var("BASE_URL")
        .unwrap_or_else(|_| format!("http://localhost:{}", port));

    let game_config = config::load_game_config();
    let quizzes = config::load_quizzes();

    let registry = Registry::new();

    let state = AppState {
        registry,
        base_url,
        game_config,
        quizzes,
    };

    let app = Router::new()
        .route("/", get(index_page))
        .route("/manager", get(manager_page))
        .route("/game/{game_id}", get(game_page))
        .route("/ws", get(ws_handler))
        .route("/images/{*path}", get(serve_config_image))
        .nest_service("/static", ServeDir::new("static"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind");

    tracing::info!("QuizRush server running on port {}", port);

    axum::serve(listener, app).await.unwrap();
}
