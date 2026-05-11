# Quiz JSON Format

This document explains how to write a quiz JSON file compatible with Rahoot import.

## Where to put quiz files

- Local examples are in `config/quizz/`
- You can also import a `.json` file from the manager UI

## Required root structure

Your JSON file must contain:

- `subject`: non-empty string
- `questions`: array with at least 1 question

Example root:

```json
{
  "subject": "My Quiz",
  "questions": []
}
```

## Question object format

Each question object supports:

- `question` (required): non-empty string
- `answers` (required): array of at least 2 non-empty strings
- `solution` (required): integer index of correct answer
- `cooldown` (required): integer >= 1 (seconds before answers are shown)
- `time` (required): integer >= 1 (seconds to answer)
- `image` (optional): valid URL
- `video` (optional): valid URL
- `audio` (optional): valid URL
- `answer-image` (optional): valid URL

## Validation rules

- `solution` must be `>= 0`
- `solution` must be `< answers.length`
- `cooldown` and `time` must be positive integers
- Optional media fields must be valid URLs (for example `https://...`)

## Complete example (ready to import)

```json
{
  "subject": "Le Systeme solaire",
  "questions": [
    {
      "question": "Quelle est la planete la plus proche du Soleil ?",
      "answers": ["Mercure", "Venus", "Terre", "Mars"],
      "solution": 0,
      "cooldown": 5,
      "time": 15
    },
    {
      "question": "Quelle est la plus grande planete du Systeme solaire ?",
      "answers": ["Saturne", "Jupiter", "Neptune", "Uranus"],
      "solution": 1,
      "cooldown": 5,
      "time": 15
    },
    {
      "question": "Quelle planete est surnommee la planete rouge ?",
      "answers": ["Venus", "Mars", "Mercure", "Saturne"],
      "solution": 1,
      "cooldown": 5,
      "time": 15
    }
  ]
}
```

## Common mistakes

- Setting `solution` to `1` for the first answer (indexes start at `0`)
- Using an empty answer string
- Using only one answer
- Using a local media path instead of a URL
- Using decimal values for `time` or `cooldown`
