"use client"

import { QuizzWithId } from "@rahoot/common/types/game"
import { STATUS } from "@rahoot/common/types/game/status"
import ManagerPassword from "@rahoot/web/components/game/create/ManagerPassword"
import QuizStudio from "@rahoot/web/components/quiz/QuizStudio"
import { useEvent, useSocket } from "@rahoot/web/contexts/socketProvider"
import { useManagerStore } from "@rahoot/web/stores/manager"
import { useRouter } from "next/navigation"
import { useState } from "react"
import toast from "react-hot-toast"

type EditableQuizz = {
  subject: string
  questions: {
    question: string
    image?: string
    video?: string
    audio?: string
    "answer-image"?: string
    answers: string[]
    solution: number
    cooldown: number
    time: number
  }[]
}

const ManagerStudio = () => {
  const { setGameId, setStatus } = useManagerStore()
  const router = useRouter()
  const { socket } = useSocket()

  const [isAuth, setIsAuth] = useState(false)
  const [quizzList, setQuizzList] = useState<QuizzWithId[]>([])

  useEvent("manager:quizzList", (nextQuizzList) => {
    setIsAuth(true)
    setQuizzList(nextQuizzList)
  })

  useEvent("manager:errorMessage", (message) => {
    toast.error(message)
  })

  useEvent("manager:quizzSaved", ({ subject }) => {
    toast.success(`Quizz "${subject}" saved`)
  })

  useEvent("manager:quizzDeleted", ({ id }) => {
    toast.success(`Quizz "${id}" deleted`)
  })

  useEvent("manager:quizzImported", ({ subject }) => {
    toast.success(`Quizz "${subject}" imported`)
  })

  useEvent("manager:gameCreated", ({ gameId, inviteCode }) => {
    setGameId(gameId)
    setStatus(STATUS.SHOW_ROOM, { text: "Waiting for the players", inviteCode })
    router.push(`/game/manager/${gameId}`)
  })

  const handleAuth = (password: string) => {
    socket?.emit("manager:auth", password)
  }

  const handleGoogleAuth = (credential: string) => {
    socket?.emit("manager:googleAuth", credential)
  }

  const handleSave = async ({
    id,
    quizz,
  }: {
    id?: string
    quizz: EditableQuizz
  }) => {
    return await new Promise<string | void>((resolve, reject) => {
      socket?.emit("manager:saveQuizz", { id, quizz }, ({ id: savedId }) => {
        resolve(savedId)
      })

      if (!socket) {
        reject(new Error("Socket not available"))
      }
    })
  }

  const handleDelete = async (id: string) => {
    socket?.emit("manager:deleteQuizz", { id })
  }

  if (!isAuth) {
    return (
      <ManagerPassword onSubmit={handleAuth} onGoogleAuth={handleGoogleAuth} />
    )
  }

  return (
    <QuizStudio
      quizzList={quizzList}
      onSave={handleSave}
      onDelete={handleDelete}
    />
  )
}

export default ManagerStudio
