use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use rand::Rng;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::config;
use crate::types::*;

/// Commands the WebSocket handler sends to a game task.
#[derive(Debug, Clone)]
pub enum GameCommand {
    Join {
        socket_id: String,
        client_id: String,
        username: String,
    },
    SelectAnswer {
        socket_id: String,
        answer_key: usize,
    },
    StartGame {
        socket_id: String,
    },
    AbortQuiz {
        socket_id: String,
    },
    NextQuestion {
        socket_id: String,
    },
    ShowLeaderboard {},
    KickPlayer {
        socket_id: String,
        player_id: String,
    },
    PlayerDisconnect {
        socket_id: String,
    },
    ManagerDisconnect {
        socket_id: String,
    },
    PlayerReconnect {
        socket_id: String,
        client_id: String,
    },
    ManagerReconnect {
        socket_id: String,
        client_id: String,
    },
    ManagerDisconnectCheck {
        game_id: String,
    },
}

/// Events broadcast from the game to WebSocket connections.
#[derive(Debug, Clone)]
pub enum GameEvent {
    /// Send a message to a specific socket.
    SendTo { socket_id: String, msg: ServerMsg },
    /// Broadcast a message to all sockets in the game.
    Broadcast { msg: ServerMsg },
    /// Broadcast a message to all except the sender.
    BroadcastExcept { exclude: String, msg: ServerMsg },
    /// Remove a socket from the game room.
    KickSocket { socket_id: String, msg: ServerMsg },
}

fn create_invite_code() -> String {
    let mut rng = rand::rng();
    (0..6).map(|_| char::from(b'0' + rng.random_range(0..10))).collect()
}

fn time_to_points(start_time: Instant, max_seconds: u64) -> f64 {
    let elapsed = start_time.elapsed().as_secs_f64();
    let points = 1000.0 - (1000.0 / max_seconds as f64) * elapsed;
    points.max(0.0)
}

/// The internal state of a running game.
struct GameState {
    game_id: String,
    invite_code: String,
    manager_socket_id: String,
    manager_client_id: String,
    manager_connected: bool,
    started: bool,

    quiz: Quiz,
    players: Vec<Player>,

    current_question: usize,
    round_answers: Vec<Answer>,
    round_start_time: Instant,

    leaderboard: Vec<Player>,
    old_leaderboard: Option<Vec<Player>>,

    cooldown_cancel: Option<tokio::sync::watch::Sender<bool>>,

    last_broadcast_status: Option<(GameStatus, serde_json::Value)>,
    manager_status: Option<(GameStatus, serde_json::Value)>,
    player_statuses: HashMap<String, (GameStatus, serde_json::Value)>,

    base_url: String,
}

impl GameState {
    fn broadcast(&self, tx: &broadcast::Sender<GameEvent>, msg: ServerMsg) {
        let _ = tx.send(GameEvent::Broadcast { msg });
    }

    fn send_to(&self, tx: &broadcast::Sender<GameEvent>, socket_id: &str, msg: ServerMsg) {
        let _ = tx.send(GameEvent::SendTo {
            socket_id: socket_id.to_string(),
            msg,
        });
    }

    fn broadcast_status(&mut self, tx: &broadcast::Sender<GameEvent>, status: GameStatus, data: serde_json::Value) {
        self.last_broadcast_status = Some((status, data.clone()));
        self.broadcast(tx, ServerMsg::GameStatus { status, data });
    }

    fn send_status(&mut self, tx: &broadcast::Sender<GameEvent>, target: &str, status: GameStatus, data: serde_json::Value) {
        if target == self.manager_socket_id {
            self.manager_status = Some((status, data.clone()));
        } else {
            self.player_statuses.insert(target.to_string(), (status, data.clone()));
        }
        self.send_to(tx, target, ServerMsg::GameStatus { status, data });
    }

    fn broadcast_total_players(&self, tx: &broadcast::Sender<GameEvent>) {
        let count = self.players.iter().filter(|p| p.connected).count();
        self.broadcast(tx, ServerMsg::TotalPlayers { count });
    }

    fn question_progress(&self) -> QuestionProgress {
        QuestionProgress {
            current: self.current_question + 1,
            total: self.quiz.questions.len(),
        }
    }

    fn resolve_image(&self, path: Option<&str>) -> Option<String> {
        config::resolve_image_url(path, &self.base_url)
    }

    fn cancel_cooldown(&mut self) {
        if let Some(cancel) = self.cooldown_cancel.take() {
            let _ = cancel.send(true);
        }
    }
}

/// Registry holds all active games.
pub struct Registry {
    /// game_id -> command sender
    pub games: dashmap::DashMap<String, GameHandle>,
    /// invite_code -> game_id
    pub invite_codes: dashmap::DashMap<String, String>,
    /// socket_id -> game_id  (for player sockets)
    pub player_sockets: dashmap::DashMap<String, String>,
    /// socket_id -> game_id  (for manager sockets)
    pub manager_sockets: dashmap::DashMap<String, String>,
}

#[derive(Clone)]
pub struct GameHandle {
    pub game_id: String,
    pub invite_code: String,
    pub cmd_tx: mpsc::Sender<GameCommand>,
    pub event_tx: broadcast::Sender<GameEvent>,
}

impl Registry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            games: dashmap::DashMap::new(),
            invite_codes: dashmap::DashMap::new(),
            player_sockets: dashmap::DashMap::new(),
            manager_sockets: dashmap::DashMap::new(),
        })
    }

    pub fn remove_game(&self, game_id: &str) {
        if let Some((_, handle)) = self.games.remove(game_id) {
            self.invite_codes.remove(&handle.invite_code);
        }
        // Clean up socket mappings
        self.player_sockets.retain(|_, gid| gid != game_id);
        self.manager_sockets.retain(|_, gid| gid != game_id);
    }
}

/// Create a new game and spawn its task. Returns the game handle.
pub fn create_game(
    registry: Arc<Registry>,
    manager_socket_id: String,
    manager_client_id: String,
    quiz: Quiz,
    base_url: String,
) -> GameHandle {
    let game_id = Uuid::new_v4().to_string();
    let invite_code = create_invite_code();

    let (cmd_tx, cmd_rx) = mpsc::channel(256);
    let (event_tx, _) = broadcast::channel(256);

    let handle = GameHandle {
        game_id: game_id.clone(),
        invite_code: invite_code.clone(),
        cmd_tx,
        event_tx: event_tx.clone(),
    };

    registry.games.insert(game_id.clone(), handle.clone());
    registry.invite_codes.insert(invite_code.clone(), game_id.clone());
    registry.manager_sockets.insert(manager_socket_id.clone(), game_id.clone());

    let state = GameState {
        game_id: game_id.clone(),
        invite_code: invite_code.clone(),
        manager_socket_id: manager_socket_id.clone(),
        manager_client_id,
        manager_connected: true,
        started: false,
        quiz,
        players: Vec::new(),
        current_question: 0,
        round_answers: Vec::new(),
        round_start_time: Instant::now(),
        leaderboard: Vec::new(),
        old_leaderboard: None,
        cooldown_cancel: None,
        last_broadcast_status: None,
        manager_status: None,
        player_statuses: HashMap::new(),
        base_url,
    };

    let reg = registry.clone();
    tokio::spawn(game_task(state, cmd_rx, event_tx, reg));

    tracing::info!("Game created: {} invite: {}", game_id, invite_code);

    handle
}

async fn run_cooldown(
    seconds: u64,
    event_tx: &broadcast::Sender<GameEvent>,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
) {
    for i in (1..seconds).rev() {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                let _ = event_tx.send(GameEvent::Broadcast {
                    msg: ServerMsg::Cooldown { count: i },
                });
            }
            _ = cancel_rx.changed() => {
                return;
            }
        }
    }
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
}

async fn game_task(
    mut state: GameState,
    mut cmd_rx: mpsc::Receiver<GameCommand>,
    event_tx: broadcast::Sender<GameEvent>,
    registry: Arc<Registry>,
) {
    // Process commands
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            GameCommand::Join { socket_id, client_id, username } => {
                handle_join(&mut state, &event_tx, &registry, socket_id, client_id, username);
            }
            GameCommand::SelectAnswer { socket_id, answer_key } => {
                handle_select_answer(&mut state, &event_tx, socket_id, answer_key);
            }
            GameCommand::StartGame { socket_id } => {
                if socket_id == state.manager_socket_id && !state.started {
                    state.started = true;
                    handle_start_game(&mut state, &event_tx).await;
                }
            }
            GameCommand::AbortQuiz { socket_id } => {
                if socket_id == state.manager_socket_id && state.started {
                    state.cancel_cooldown();
                }
            }
            GameCommand::NextQuestion { socket_id } => {
                if socket_id == state.manager_socket_id && state.started {
                    if state.current_question + 1 < state.quiz.questions.len() {
                        state.current_question += 1;
                        handle_new_round(&mut state, &event_tx).await;
                    }
                }
            }
            GameCommand::ShowLeaderboard {} => {
                handle_show_leaderboard(&mut state, &event_tx);
            }
            GameCommand::KickPlayer { socket_id, player_id } => {
                handle_kick_player(&mut state, &event_tx, &registry, socket_id, player_id);
            }
            GameCommand::PlayerDisconnect { socket_id } => {
                handle_player_disconnect(&mut state, &event_tx, &registry, socket_id);
            }
            GameCommand::ManagerDisconnect { socket_id } => {
                handle_manager_disconnect(&mut state, &event_tx, &registry, socket_id);
            }
            GameCommand::PlayerReconnect { socket_id, client_id } => {
                handle_player_reconnect(&mut state, &event_tx, &registry, socket_id, client_id);
            }
            GameCommand::ManagerReconnect { socket_id, client_id } => {
                handle_manager_reconnect(&mut state, &event_tx, &registry, socket_id, client_id);
            }
            GameCommand::ManagerDisconnectCheck { game_id } => {
                if game_id == state.game_id && !state.manager_connected && !state.started {
                    state.cancel_cooldown();
                    state.broadcast(&event_tx, ServerMsg::Reset {
                        message: "Manager disconnected".to_string(),
                    });
                    registry.remove_game(&state.game_id);
                }
            }
        }
    }

    // Channel closed - cleanup
    registry.remove_game(&state.game_id);
    tracing::info!("Game {} task ended", state.game_id);
}

fn handle_join(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
    registry: &Arc<Registry>,
    socket_id: String,
    client_id: String,
    username: String,
) {
    if state.players.iter().any(|p| p.client_id == client_id) {
        state.send_to(tx, &socket_id, ServerMsg::ErrorMessage {
            message: "Player already connected".to_string(),
        });
        return;
    }

    if username.len() < 4 {
        state.send_to(tx, &socket_id, ServerMsg::ErrorMessage {
            message: "Username cannot be less than 4 characters".to_string(),
        });
        return;
    }
    if username.len() > 20 {
        state.send_to(tx, &socket_id, ServerMsg::ErrorMessage {
            message: "Username cannot exceed 20 characters".to_string(),
        });
        return;
    }

    let player = Player {
        id: socket_id.clone(),
        client_id,
        connected: true,
        username,
        points: 0.0,
    };

    state.players.push(player.clone());
    registry.player_sockets.insert(socket_id.clone(), state.game_id.clone());

    state.send_to(tx, &state.manager_socket_id.clone(), ServerMsg::NewPlayer {
        player: player.clone(),
    });
    state.broadcast_total_players(tx);
    state.send_to(tx, &socket_id, ServerMsg::SuccessJoin {
        game_id: state.game_id.clone(),
    });
}

fn handle_select_answer(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
    socket_id: String,
    answer_key: usize,
) {
    let player = state.players.iter().find(|p| p.id == socket_id);
    if player.is_none() {
        return;
    }

    if state.round_answers.iter().any(|a| a.player_id == socket_id) {
        return;
    }

    let question = &state.quiz.questions[state.current_question];
    let points = time_to_points(state.round_start_time, question.time);

    state.round_answers.push(Answer {
        player_id: socket_id.clone(),
        answer_id: answer_key,
        points,
    });

    state.send_status(tx, &socket_id, GameStatus::Wait, serde_json::json!({
        "text": "Waiting for the players to answer"
    }));

    let _ = tx.send(GameEvent::BroadcastExcept {
        exclude: socket_id,
        msg: ServerMsg::PlayerAnswer {
            count: state.round_answers.len(),
        },
    });

    state.broadcast_total_players(tx);

    let connected_count = state.players.iter().filter(|p| p.connected).count();
    if state.round_answers.len() >= connected_count {
        state.cancel_cooldown();
    }
}

async fn handle_start_game(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
) {
    state.broadcast_status(tx, GameStatus::ShowStart, serde_json::json!({
        "time": 3,
        "subject": state.quiz.subject,
    }));

    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    state.broadcast(tx, ServerMsg::StartCooldown);

    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    state.cooldown_cancel = Some(cancel_tx);
    run_cooldown(3, tx, &mut cancel_rx).await;
    state.cooldown_cancel = None;

    handle_new_round(state, tx).await;
}

async fn handle_new_round(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
) {
    if !state.started {
        return;
    }

    let question = state.quiz.questions[state.current_question].clone();
    state.player_statuses.clear();
    state.round_answers.clear();

    state.broadcast(tx, ServerMsg::UpdateQuestion {
        current: state.current_question + 1,
        total: state.quiz.questions.len(),
    });

    state.manager_status = None;
    state.broadcast_status(tx, GameStatus::ShowPrepared, serde_json::json!({
        "totalAnswers": question.answers.len(),
        "questionNumber": state.current_question + 1,
    }));

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    if !state.started {
        return;
    }

    let image = state.resolve_image(question.image.as_deref());
    state.broadcast_status(tx, GameStatus::ShowQuestion, serde_json::json!({
        "question": question.question,
        "image": image,
        "cooldown": question.cooldown,
    }));

    tokio::time::sleep(std::time::Duration::from_secs(question.cooldown)).await;

    if !state.started {
        return;
    }

    state.round_start_time = Instant::now();

    let connected_count = state.players.iter().filter(|p| p.connected).count();
    state.broadcast_status(tx, GameStatus::SelectAnswer, serde_json::json!({
        "question": question.question,
        "answers": question.answers,
        "image": state.resolve_image(question.image.as_deref()),
        "video": question.video,
        "audio": question.audio,
        "time": question.time,
        "totalPlayer": connected_count,
    }));

    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    state.cooldown_cancel = Some(cancel_tx);
    run_cooldown(question.time, tx, &mut cancel_rx).await;
    state.cooldown_cancel = None;

    if !state.started {
        return;
    }

    handle_show_results(state, tx);
}

fn handle_show_results(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
) {
    let question = &state.quiz.questions[state.current_question];
    let solution = question.solution;
    let answer_image_raw = question.answer_image.clone();
    let question_text = question.question.clone();
    let question_answers = question.answers.clone();
    let question_image_raw = question.image.clone();
    let _ = question;

    let old_leaderboard = if state.leaderboard.is_empty() {
        state.players.clone()
    } else {
        state.leaderboard.clone()
    };

    // Count responses per answer
    let mut responses: HashMap<usize, usize> = HashMap::new();
    for ans in &state.round_answers {
        *responses.entry(ans.answer_id).or_insert(0) += 1;
    }

    // Calculate points and sort
    let mut scored: Vec<(usize, bool, f64)> = Vec::new(); // index, correct, earned_points

    for (i, player) in state.players.iter_mut().enumerate() {
        let player_answer = state.round_answers.iter().find(|a| a.player_id == player.id);

        let is_correct = player_answer
            .map(|a| a.answer_id == solution)
            .unwrap_or(false);

        let earned = if is_correct {
            player_answer.map(|a| a.points.round()).unwrap_or(0.0)
        } else {
            0.0
        };

        player.points += earned;
        scored.push((i, is_correct, earned));
    }

    // Sort players by points descending
    state.players.sort_by(|a, b| b.points.partial_cmp(&a.points).unwrap_or(std::cmp::Ordering::Equal));

    let answer_image = state.resolve_image(answer_image_raw.as_deref());

    // Collect per-player result data
    let result_msgs: Vec<(String, serde_json::Value)> = state.players.iter().enumerate().map(|(rank, player)| {
        let player_answer = state.round_answers.iter().find(|a| a.player_id == player.id);
        let is_correct = player_answer
            .map(|a| a.answer_id == solution)
            .unwrap_or(false);
        let earned = if is_correct {
            player_answer.map(|a| a.points.round()).unwrap_or(0.0)
        } else {
            0.0
        };

        let ahead = if rank > 0 {
            Some(state.players[rank - 1].username.clone())
        } else {
            None
        };

        (player.id.clone(), serde_json::json!({
            "correct": is_correct,
            "message": if is_correct { "Nice!" } else { "Too bad" },
            "points": earned as i64,
            "myPoints": player.points as i64,
            "rank": rank + 1,
            "aheadOfMe": ahead,
            "answerImage": answer_image,
        }))
    }).collect();

    // Send individual results to each player
    for (player_id, data) in result_msgs {
        state.send_status(tx, &player_id, GameStatus::ShowResult, data);
    }

    // Send responses view to manager
    let responses_json: serde_json::Value = responses.iter()
        .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
        .collect::<serde_json::Map<String, serde_json::Value>>()
        .into();

    state.send_status(tx, &state.manager_socket_id.clone(), GameStatus::ShowResponses, serde_json::json!({
        "question": question_text,
        "responses": responses_json,
        "correct": solution,
        "answers": question_answers,
        "image": state.resolve_image(question_image_raw.as_deref()),
    }));

    state.leaderboard = state.players.clone();
    state.old_leaderboard = Some(old_leaderboard);
}

fn handle_show_leaderboard(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
) {
    let is_last = state.current_question + 1 == state.quiz.questions.len();

    if is_last {
        state.started = false;
        let top: Vec<Player> = state.leaderboard.iter().take(3).cloned().collect();
        state.broadcast_status(tx, GameStatus::Finished, serde_json::json!({
            "subject": state.quiz.subject,
            "top": top,
        }));
        return;
    }

    let old = state.old_leaderboard.take().unwrap_or_else(|| state.leaderboard.clone());

    state.send_status(tx, &state.manager_socket_id.clone(), GameStatus::ShowLeaderboard, serde_json::json!({
        "oldLeaderboard": old.iter().take(5).collect::<Vec<_>>(),
        "leaderboard": state.leaderboard.iter().take(5).collect::<Vec<_>>(),
    }));
}

fn handle_kick_player(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
    registry: &Arc<Registry>,
    socket_id: String,
    player_id: String,
) {
    if socket_id != state.manager_socket_id {
        return;
    }

    let player = state.players.iter().find(|p| p.id == player_id).cloned();
    if let Some(player) = player {
        state.players.retain(|p| p.id != player_id);
        state.player_statuses.remove(&player_id);
        registry.player_sockets.remove(&player_id);

        let _ = tx.send(GameEvent::KickSocket {
            socket_id: player.id.clone(),
            msg: ServerMsg::Reset {
                message: "You have been kicked by the manager".to_string(),
            },
        });

        state.send_to(tx, &state.manager_socket_id.clone(), ServerMsg::PlayerKicked {
            player_id: player.id,
        });
        state.broadcast_total_players(tx);
    }
}

fn handle_player_disconnect(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
    registry: &Arc<Registry>,
    socket_id: String,
) {
    registry.player_sockets.remove(&socket_id);

    if let Some(player) = state.players.iter_mut().find(|p| p.id == socket_id) {
        if !state.started {
            let player_id = player.id.clone();
            state.players.retain(|p| p.id != player_id);
            state.send_to(tx, &state.manager_socket_id.clone(), ServerMsg::RemovePlayer {
                player_id,
            });
        } else {
            player.connected = false;
        }
        state.broadcast_total_players(tx);
    }
}

fn handle_manager_disconnect(
    state: &mut GameState,
    _tx: &broadcast::Sender<GameEvent>,
    registry: &Arc<Registry>,
    socket_id: String,
) {
    if socket_id != state.manager_socket_id {
        return;
    }

    state.manager_connected = false;
    registry.manager_sockets.remove(&socket_id);

    // Schedule delayed cleanup — give the manager time to reconnect
    // (e.g. during page navigation from /manager to /game/{id})
    let game_id = state.game_id.clone();
    let cmd_tx = registry.games.get(&game_id).map(|h| h.cmd_tx.clone());
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        // After 10s, check if manager reconnected by sending a check command
        if let Some(tx) = cmd_tx {
            let _ = tx.send(GameCommand::ManagerDisconnectCheck {
                game_id: game_id.clone(),
            }).await;
        }
    });
}

fn handle_player_reconnect(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
    registry: &Arc<Registry>,
    socket_id: String,
    client_id: String,
) {
    let player = state.players.iter_mut().find(|p| p.client_id == client_id);
    let Some(player) = player else {
        state.send_to(tx, &socket_id, ServerMsg::Reset {
            message: "Game not found".to_string(),
        });
        return;
    };

    if player.connected {
        state.send_to(tx, &socket_id, ServerMsg::Reset {
            message: "Player already connected".to_string(),
        });
        return;
    }

    let old_id = player.id.clone();
    player.id = socket_id.clone();
    player.connected = true;

    registry.player_sockets.remove(&old_id);
    registry.player_sockets.insert(socket_id.clone(), state.game_id.clone());

    // Migrate player status
    if let Some(old_status) = state.player_statuses.remove(&old_id) {
        state.player_statuses.insert(socket_id.clone(), old_status);
    }

    let (status, data) = state.player_statuses.get(&socket_id)
        .or(state.last_broadcast_status.as_ref())
        .cloned()
        .unwrap_or((GameStatus::Wait, serde_json::json!({"text": "Waiting for players"})));

    let username = player.username.clone();
    let points = player.points;

    state.send_to(tx, &socket_id, ServerMsg::PlayerReconnected {
        game_id: state.game_id.clone(),
        status,
        data,
        username,
        points,
        current_question: state.question_progress(),
    });
    state.broadcast_total_players(tx);

    tracing::info!("Player reconnected to game {}", state.invite_code);
}

fn handle_manager_reconnect(
    state: &mut GameState,
    tx: &broadcast::Sender<GameEvent>,
    registry: &Arc<Registry>,
    socket_id: String,
    client_id: String,
) {
    if state.manager_client_id != client_id {
        state.send_to(tx, &socket_id, ServerMsg::Reset {
            message: "Game not found".to_string(),
        });
        return;
    }

    if state.manager_connected {
        state.send_to(tx, &socket_id, ServerMsg::Reset {
            message: "Manager already connected".to_string(),
        });
        return;
    }

    let old_id = state.manager_socket_id.clone();
    state.manager_socket_id = socket_id.clone();
    state.manager_connected = true;

    registry.manager_sockets.remove(&old_id);
    registry.manager_sockets.insert(socket_id.clone(), state.game_id.clone());

    let (status, data) = state.manager_status.clone()
        .or_else(|| state.last_broadcast_status.clone())
        .unwrap_or((GameStatus::Wait, serde_json::json!({"text": "Waiting for players"})));

    state.send_to(tx, &socket_id, ServerMsg::ManagerReconnected {
        game_id: state.game_id.clone(),
        status,
        data,
        players: state.players.clone(),
        current_question: state.question_progress(),
    });
    state.broadcast_total_players(tx);

    tracing::info!("Manager reconnected to game {}", state.invite_code);
}
