"use client"

import { QuizzWithId } from "@rahoot/common/types/game"
import { STATUS } from "@rahoot/common/types/game/status"
import ManagerPassword from "@rahoot/web/components/game/create/ManagerPassword"
import SelectQuizz from "@rahoot/web/components/game/create/SelectQuizz"
import { useEvent, useSocket } from "@rahoot/web/contexts/socketProvider"
import { useManagerStore } from "@rahoot/web/stores/manager"
import { useRouter } from "next/navigation"
import { useState } from "react"
import toast from "react-hot-toast"

const Manager = () => {
  const { setGameId, setStatus } = useManagerStore()
  const router = useRouter()
  const { socket } = useSocket()

  const [isAuth, setIsAuth] = useState(false)
  const [quizzList, setQuizzList] = useState<QuizzWithId[]>([])

  useEvent("manager:quizzList", (quizzList) => {
    setIsAuth(true)
    setQuizzList(quizzList)
  })

  useEvent("manager:errorMessage", (message) => {
    toast.error(message)
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
  const handleCreate = (quizzId: string) => {
    socket?.emit("game:create", quizzId)
  }

  const handleImport = ({
    fileName,
    content,
  }: {
    fileName: string
    content: string
  }) => {
    socket?.emit("manager:importQuizz", { fileName, content })
  }

  if (!isAuth) {
    return (
      <ManagerPassword onSubmit={handleAuth} onGoogleAuth={handleGoogleAuth} />
    )
  }

  return (
    <SelectQuizz
      quizzList={quizzList}
      onSelect={handleCreate}
      onImport={handleImport}
    />
  )
}

export default Manager
