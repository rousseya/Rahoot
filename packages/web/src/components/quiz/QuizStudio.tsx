"use client"

import { QuizzWithId } from "@rahoot/common/types/game"
import Button from "@rahoot/web/components/Button"
import clsx from "clsx"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"

type EditableQuestion = {
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

type EditableQuizz = {
  subject: string
  questions: EditableQuestion[]
}

type Props = {
  quizzList: QuizzWithId[]
  onSave: (_data: {
    id?: string
    quizz: EditableQuizz
  }) => Promise<string | void>
  onDelete: (_id: string) => Promise<void> | void
}

const createBlankQuizz = (): string =>
  JSON.stringify(
    {
      subject: "Nouveau quizz",
      questions: [
        {
          question: "",
          answers: ["", ""],
          solution: 0,
          cooldown: 5,
          time: 15,
        },
      ],
    },
    null,
    2,
  )

const toPrettyJson = (value: unknown) => JSON.stringify(value, null, 2)

const QuizStudio = ({ quizzList, onSave, onDelete }: Props) => {
  const [selectedId, setSelectedId] = useState<string | null>(
    quizzList[0]?.id ?? null,
  )
  const [jsonText, setJsonText] = useState<string>(
    quizzList[0] ? toPrettyJson(quizzList[0]) : createBlankQuizz(),
  )
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0)
  const [aiPrompt, setAiPrompt] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDrafting, setIsDrafting] = useState(false)
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)

  useEffect(() => {
    if (selectedId) {
      const selectedQuizz = quizzList.find((quizz) => quizz.id === selectedId)

      if (selectedQuizz) {
        setJsonText(toPrettyJson(selectedQuizz))
        return
      }

      if (quizzList[0]) {
        setSelectedId(quizzList[0].id)
        setJsonText(toPrettyJson(quizzList[0]))
        setSelectedQuestionIndex(0)
        return
      }
    }

    if (!selectedId && quizzList.length === 0) {
      setJsonText(createBlankQuizz())
    }
  }, [quizzList, selectedId])

  let parsedQuizz: EditableQuizz | null = null
  let parseError: string | null = null

  try {
    parsedQuizz = JSON.parse(jsonText) as EditableQuizz
  } catch (error) {
    parseError = error instanceof Error ? error.message : "Invalid JSON"
  }

  const questions = parsedQuizz?.questions ?? []
  const selectedQuestion =
    questions[selectedQuestionIndex] ?? questions[0] ?? null

  const selectQuizz = (quizz: QuizzWithId) => {
    setSelectedId(quizz.id)
    setJsonText(toPrettyJson(quizz))
    setSelectedQuestionIndex(0)
  }

  const startNewQuizz = () => {
    setSelectedId(null)
    setJsonText(createBlankQuizz())
    setSelectedQuestionIndex(0)
  }

  const handleSave = async () => {
    if (!parsedQuizz) {
      toast.error(parseError || "Invalid quiz JSON")

      return
    }

    try {
      setIsSaving(true)
      const savedId = await onSave({
        id: selectedId ?? undefined,
        quizz: parsedQuizz,
      })

      if (savedId) {
        setSelectedId(savedId)
      }

      toast.success("Quizz saved")
    } catch (error) {
      console.error("Failed to save quizz:", error)
      toast.error("Failed to save quizz")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedId) {
      toast.error("Select a quizz to delete")

      return
    }

    const confirmed = window.confirm(
      `Delete quiz \"${selectedId}\"? This cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      await onDelete(selectedId)
      startNewQuizz()
      toast.success("Quizz deleted")
    } catch (error) {
      console.error("Failed to delete quizz:", error)
      toast.error("Failed to delete quizz")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleGenerateDraft = async () => {
    try {
      setIsDrafting(true)

      const response = await fetch("/api/ai/quizz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "draft",
          prompt: aiPrompt.trim(),
          subject: parsedQuizz?.subject ?? "",
        }),
      })

      const data = (await response.json()) as {
        quizz?: EditableQuizz
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || "AI draft generation failed")
      }

      if (!data.quizz) {
        throw new Error("Invalid AI draft response")
      }

      setSelectedId(null)
      setSelectedQuestionIndex(0)
      setJsonText(toPrettyJson(data.quizz))
      toast.success("AI draft generated")
    } catch (error) {
      console.error("Failed to generate draft:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to generate draft",
      )
    } finally {
      setIsDrafting(false)
    }
  }

  const handleGenerateImage = async () => {
    if (!parsedQuizz || !selectedQuestion) {
      toast.error("Select a valid question first")

      return
    }

    try {
      setIsGeneratingImage(true)

      const response = await fetch("/api/ai/quizz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "image",
          prompt: aiPrompt.trim() || selectedQuestion.question,
          subject: parsedQuizz.subject,
          question: selectedQuestion.question,
        }),
      })

      const data = (await response.json()) as {
        url?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || "AI image generation failed")
      }

      if (!data.url) {
        throw new Error("Invalid AI image response")
      }

      const updatedQuizz = JSON.parse(
        JSON.stringify(parsedQuizz),
      ) as EditableQuizz
      updatedQuizz.questions[selectedQuestionIndex].image = data.url
      setJsonText(toPrettyJson(updatedQuizz))
      toast.success("Image generated and applied")
    } catch (error) {
      console.error("Failed to generate image:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to generate image",
      )
    } finally {
      setIsGeneratingImage(false)
    }
  }

  return (
    <div className="z-10 flex w-full max-w-7xl flex-col gap-4 rounded-md bg-white p-4 shadow-sm lg:p-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex w-full flex-col gap-3 lg:w-72 lg:border-r lg:border-gray-200 lg:pr-4">
          <div>
            <h1 className="text-2xl font-bold">Quiz Studio</h1>
            <p className="text-sm text-gray-500">
              Create, edit and preview quizzes in JSON.
            </p>
          </div>

          <Button onClick={startNewQuizz} className="bg-gray-200 text-gray-800">
            New quizz
          </Button>

          <div className="max-h-[30rem] space-y-2 overflow-auto pr-1">
            {quizzList.map((quizz) => (
              <button
                key={quizz.id}
                onClick={() => selectQuizz(quizz)}
                className={clsx(
                  "flex w-full flex-col rounded-md border p-3 text-left transition",
                  selectedId === quizz.id
                    ? "border-primary bg-primary/10"
                    : "border-gray-200 hover:border-gray-400",
                )}
              >
                <span className="font-semibold">{quizz.subject}</span>
                <span className="text-xs text-gray-500">
                  {quizz.questions.length} question
                  {quizz.questions.length > 1 ? "s" : ""}
                </span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={isSaving || isDrafting || isGeneratingImage}
              className="flex-1"
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              onClick={handleDelete}
              disabled={!selectedId || isSaving || isDeleting}
              className="bg-red-500 text-white"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-600">
              AI prompt
            </label>
            <textarea
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="Ex: un quiz de culture générale sur le système solaire, en français, avec 5 questions"
              className="focus:border-primary min-h-24 w-full rounded-md border border-gray-300 bg-white p-3 text-sm transition outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleGenerateDraft}
              disabled={isDrafting || isSaving || isGeneratingImage}
            >
              {isDrafting ? "Generating..." : "Generate quiz draft"}
            </Button>
            <Button
              onClick={handleGenerateImage}
              disabled={isGeneratingImage || isSaving || isDrafting}
              className="bg-gray-200 text-gray-800"
            >
              {isGeneratingImage
                ? "Generating..."
                : "Generate image for selected question"}
            </Button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-600">
                Quiz JSON
              </label>
              <textarea
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                spellCheck={false}
                className="focus:border-primary min-h-[42rem] w-full rounded-md border border-gray-300 bg-gray-50 p-4 font-mono text-sm transition outline-none"
              />
              {parseError && (
                <p className="text-sm text-red-600">JSON error: {parseError}</p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="rounded-md border border-gray-200 p-4">
                <h2 className="text-lg font-bold">
                  {parsedQuizz?.subject || "Preview"}
                </h2>
                <p className="text-sm text-gray-500">
                  {questions.length} question{questions.length > 1 ? "s" : ""}
                </p>
              </div>

              <div className="space-y-2">
                {questions.map((question, index) => (
                  <button
                    key={`${question.question}-${index}`}
                    onClick={() => setSelectedQuestionIndex(index)}
                    className={clsx(
                      "w-full rounded-md border p-3 text-left transition",
                      selectedQuestionIndex === index
                        ? "border-primary bg-primary/10"
                        : "border-gray-200 hover:border-gray-400",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">
                        Question {index + 1}
                      </span>
                      <span className="text-xs text-gray-500">
                        {question.answers.length} answers
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-700">
                      {question.question || "Untitled question"}
                    </p>
                  </button>
                ))}
              </div>

              {selectedQuestion ? (
                <div className="rounded-md border border-gray-200 p-4">
                  <h3 className="mb-2 text-base font-semibold">
                    Selected question preview
                  </h3>
                  <p className="font-medium text-gray-800">
                    {selectedQuestion.question || "Untitled question"}
                  </p>
                  <div className="mt-3 space-y-2">
                    {selectedQuestion.answers.map((answer, index) => (
                      <div
                        key={`${answer}-${index}`}
                        className={clsx(
                          "rounded-md border px-3 py-2 text-sm",
                          selectedQuestion.solution === index
                            ? "border-green-500 bg-green-50"
                            : "border-gray-200",
                        )}
                      >
                        {answer || "(empty answer)"}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-sm text-gray-500">
                    Cooldown: {selectedQuestion.cooldown}s · Time:{" "}
                    {selectedQuestion.time}s
                  </div>
                  {selectedQuestion.image && (
                    <img
                      src={selectedQuestion.image}
                      alt={selectedQuestion.question}
                      className="mt-3 w-full rounded-md border border-gray-200 object-cover"
                    />
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                  No question selected.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default QuizStudio
