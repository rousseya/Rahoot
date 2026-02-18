<p align="center">
  <img width="450" height="120" align="center" src="https://raw.githubusercontent.com/Ralex91/Rahoot/main/.github/logo.svg">
  <br>
</p>

# QuizRush

A fast, self-hosted quiz platform built in Rust — inspired by Kahoot!

## What is this project?

QuizRush is a lightweight, self-hosted alternative to Kahoot! for hosting quiz games at events, classrooms, or meetups. A single binary serves the web interface, WebSocket connections, and static assets.

**Stack:** Rust, Axum, Askama templates, WebSockets, vanilla JS

## Prerequisites

### Without Docker

- Rust 1.80+

### With Docker

- Docker and Docker Compose

## Getting Started

### Using Docker (Recommended)

```bash
docker compose up -d
```

Or build and run directly:

```bash
docker build -t quizrush .
docker run -d \
  -p 3000:3000 \
  -v ./config:/app/config \
  -e MANAGER_PASSWORD=admin \
  quizrush
```

The application will be available at **http://localhost:3000**

### Without Docker

1. Clone and build:

```bash
git clone https://github.com/Ralex91/Rahoot.git
cd Rahoot
cargo build --release
```

2. Run:

```bash
# Set the manager password
export MANAGER_PASSWORD=your_password

# Run the server
./target/release/quizrush
```

### Environment Variables

| Variable           | Default                   | Description                    |
| ------------------ | ------------------------- | ------------------------------ |
| `PORT`             | `3000`                    | Server port                    |
| `HOST`             | `0.0.0.0`                 | Bind address                   |
| `BASE_URL`         | `http://localhost:{PORT}` | Public URL (for QR codes)      |
| `CONFIG_PATH`      | `./config`                | Path to config directory       |
| `MANAGER_PASSWORD` | `admin`                   | Password for manager interface |
| `RUST_LOG`         | `info`                    | Log level                      |

## Configuration

### Game Configuration (`config/game.json`)

```json
{
  "managerPassword": "PASSWORD",
  "music": true
}
```

- `managerPassword`: Fallback password if `MANAGER_PASSWORD` env var is not set
- `music`: Enable/disable game music

### Quiz Configuration (`config/quizz/*.json`)

Create quiz files in `config/quizz/`. Select which quiz to use when starting a game.

```json
{
  "subject": "Example Quiz",
  "questions": [
    {
      "question": "What is the correct answer?",
      "answers": ["No", "Yes", "No", "No"],
      "image": "https://example.com/image.jpg",
      "solution": 1,
      "cooldown": 5,
      "time": 15
    }
  ]
}
```

- `subject`: Quiz title
- `questions[].question`: Question text
- `questions[].answers`: 2-4 answer options
- `questions[].image`: Optional image URL (or local path relative to `config/quizz/images/`)
- `questions[].solution`: Correct answer index (0-based)
- `questions[].cooldown`: Seconds before showing the question
- `questions[].time`: Seconds allowed to answer

## How to Play

1. Go to `http://localhost:3000/manager` and enter the manager password
2. Select a quiz and create a game
3. Share the URL and game PIN with players
4. Players join at `http://localhost:3000` and enter the PIN
5. Start the game and have fun!

## Contributing

1. Fork the repository
2. Create a branch (`feat/my-feature`)
3. Make your changes
4. Create a pull request
