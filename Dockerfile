FROM rust:1.87-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
COPY templates ./templates
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/quizrush /app/quizrush
COPY static ./static
COPY config ./config
EXPOSE 3000
ENV RUST_LOG=info
CMD ["./quizrush"]
