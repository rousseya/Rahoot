import { randomUUID } from "crypto"
import fs from "fs/promises"
import { NextResponse } from "next/server"
import path from "path"

const getConfigRoot = () =>
  process.env.CONFIG_PATH
    ? path.resolve(process.env.CONFIG_PATH)
    : path.resolve(process.cwd(), "config")

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || ""
const TEXT_MODEL = process.env.HUGGINGFACE_TEXT_MODEL || ""
const IMAGE_MODEL =
  process.env.HUGGINGFACE_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell"
const SOCKET_URL = (process.env.SOCKET_URL || "http://localhost:3001").replace(
  /\/$/,
  "",
)
const PREFERRED_TEXT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "deepseek-ai/DeepSeek-V4-Pro",
]

type DraftQuestion = {
  question: string
  image?: string
  video?: string
  audio?: string
  "answer-image"?: string
  answers: string[]
  solution: number
  cooldown: number
  time: number
}

type DraftQuiz = {
  subject: string
  questions: DraftQuestion[]
}

type RouterModelsResponse = {
  object: "list"
  data: {
    id: string
    architecture?: {
      input_modalities?: string[]
      output_modalities?: string[]
    }
    providers?: {
      provider: string
      status: string
    }[]
  }[]
}

const getJsonError = async (response: Response) => {
  try {
    return (await response.json()) as { error?: string; message?: string }
  } catch {
    return null
  }
}

const getSupportedTextModel = async () => {
  if (TEXT_MODEL) {
    return TEXT_MODEL
  }

  const response = await fetch("https://router.huggingface.co/v1/models", {
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error("Unable to list Hugging Face models for your token")
  }

  const payload = (await response.json()) as RouterModelsResponse

  const byId = new Map(payload.data.map((model) => [model.id, model]))

  for (const preferredModel of PREFERRED_TEXT_MODELS) {
    const model = byId.get(preferredModel)

    if (!model) {
      continue
    }

    const hasTextOutput =
      model.architecture?.output_modalities?.includes("text")
    const isLive = model.providers?.some(
      (provider) => provider.status === "live",
    )

    if (hasTextOutput && isLive) {
      return preferredModel
    }
  }

  const liveTextModel = payload.data.find((model) => {
    const hasTextOutput =
      model.architecture?.output_modalities?.includes("text")
    const isLive = model.providers?.some(
      (provider) => provider.status === "live",
    )

    return hasTextOutput && isLive
  })

  if (!liveTextModel) {
    throw new Error(
      "No live text model available for this token. Set HUGGINGFACE_TEXT_MODEL to a supported model.",
    )
  }

  return liveTextModel.id
}

const buildDraftPrompt = (prompt: string, subject: string) => {
  const normalizedPrompt = prompt.trim() || "un quiz de culture generale"
  const normalizedSubject = subject.trim() || normalizedPrompt

  return [
    "Tu es un assistant qui écrit des quizzes en français.",
    "Retourne uniquement un JSON valide, sans explication, sans markdown, sans bloc de code.",
    "Le JSON doit respecter ce format: { subject: string, questions: [{ question: string, answers: string[], solution: number, cooldown: number, time: number, image?: string, video?: string, audio?: string, 'answer-image'?: string }] }",
    "Règles: 4 réponses par question, solution indexée à partir de 0, au moins 5 questions, pas d'autres clés, au format JSON strict.",
    `Sujet du quiz: ${normalizedSubject}`,
    `Demande utilisateur: ${normalizedPrompt}`,
  ].join("\n")
}

const buildImagePrompt = (
  subject: string,
  question: string,
  prompt: string,
) => {
  const normalizedPrompt = prompt.trim() || question.trim() || subject.trim()

  return [
    "Create a high quality educational quiz illustration.",
    "No text, no watermark, no logo, centered composition, clean lighting.",
    `Quiz subject: ${subject.trim() || "general knowledge"}`,
    `Question context: ${question.trim() || normalizedPrompt}`,
    `Image prompt: ${normalizedPrompt}`,
  ].join(" ")
}

const saveImage = async (imageBuffer: ArrayBuffer) => {
  const imageDirectory = path.join(getConfigRoot(), "quizz", "images", "ai")
  await fs.mkdir(imageDirectory, { recursive: true })

  const fileName = `quiz-${Date.now()}-${randomUUID().slice(0, 8)}.png`
  const filePath = path.join(imageDirectory, fileName)

  await fs.writeFile(filePath, Buffer.from(imageBuffer))

  return `${SOCKET_URL}/images/ai/${fileName}`
}

export async function POST(request: Request) {
  if (!HF_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Hugging Face token is missing. Set HUGGINGFACE_TOKEN or HF_TOKEN in your environment.",
      },
      { status: 500 },
    )
  }

  const payload = (await request.json()) as {
    mode?: "draft" | "image"
    prompt?: string
    subject?: string
    question?: string
  }

  if (payload.mode === "image") {
    const imagePrompt = buildImagePrompt(
      payload.subject || "",
      payload.question || "",
      payload.prompt || "",
    )

    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${IMAGE_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: imagePrompt,
          parameters: {
            width: 1024,
            height: 768,
            num_inference_steps: 20,
            guidance_scale: 6.5,
          },
        }),
      },
    )

    if (!response.ok) {
      const errorPayload = await getJsonError(response)
      return NextResponse.json(
        {
          error:
            errorPayload?.error ||
            errorPayload?.message ||
            "Image generation failed",
        },
        { status: response.status },
      )
    }

    const imageUrl = await saveImage(await response.arrayBuffer())

    return NextResponse.json({ url: imageUrl })
  }

  let textModel = TEXT_MODEL

  try {
    textModel = await getSupportedTextModel()
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve a supported text model",
      },
      { status: 500 },
    )
  }

  const response = await fetch(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: textModel,
        messages: [
          {
            role: "user",
            content: buildDraftPrompt(
              payload.prompt || "",
              payload.subject || "",
            ),
          },
        ],
        max_tokens: 1400,
        temperature: 0.7,
      }),
    },
  )

  if (!response.ok) {
    const errorPayload = await getJsonError(response)
    return NextResponse.json(
      {
        error:
          errorPayload?.error ||
          errorPayload?.message ||
          "Draft generation failed",
      },
      { status: response.status },
    )
  }

  const output = (await response.json()) as {
    choices?: {
      message?: {
        content?: string
      }
    }[]
  }
  const generatedText = output.choices?.[0]?.message?.content?.trim() || ""

  if (!generatedText) {
    return NextResponse.json(
      { error: "Empty Hugging Face response" },
      { status: 502 },
    )
  }

  const cleanedText = generatedText
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")

  let quizz: DraftQuiz

  try {
    quizz = JSON.parse(cleanedText) as DraftQuiz
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Unable to parse AI response: ${error.message}`
            : "Unable to parse AI response",
        raw: cleanedText,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ quizz })
}
