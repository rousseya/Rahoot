import { QuizzWithId } from "@rahoot/common/types/game"
import Button from "@rahoot/web/components/Button"
import clsx from "clsx"
import { ChangeEvent, useRef, useState } from "react"
import toast from "react-hot-toast"

type Props = {
  quizzList: QuizzWithId[]
  onSelect: (_id: string) => void
  onImport: (_data: {
    fileName: string
    content: string
  }) => void | Promise<void>
}

const SelectQuizz = ({ quizzList, onSelect, onImport }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSelect = (id: string) => () => {
    if (selected === id) {
      setSelected(null)
    } else {
      setSelected(id)
    }
  }

  const handleSubmit = () => {
    if (!selected) {
      toast.error("Please select a quizz")

      return
    }

    onSelect(selected)
  }

  const handleOpenImport = () => {
    fileInputRef.current?.click()
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
      toast.error("Please import a JSON file")
      event.target.value = ""

      return
    }

    try {
      setIsImporting(true)
      const content = await file.text()

      await onImport({
        fileName: file.name,
        content,
      })
    } catch (error) {
      console.error("Failed to import quizz:", error)
      toast.error("Failed to import quizz")
    } finally {
      setIsImporting(false)
      event.target.value = ""
    }
  }

  return (
    <div className="z-10 flex w-full max-w-md flex-col gap-4 rounded-md bg-white p-4 shadow-sm">
      <div className="flex flex-col items-center justify-center">
        <h1 className="mb-2 text-2xl font-bold">Select a quizz</h1>
        <div className="w-full space-y-2">
          {quizzList.map((quizz) => (
            <button
              key={quizz.id}
              className={clsx(
                "flex w-full items-center justify-between rounded-md p-3 outline outline-gray-300",
              )}
              onClick={handleSelect(quizz.id)}
            >
              {quizz.subject}

              <div
                className={clsx(
                  "h-5 w-5 rounded outline outline-offset-3 outline-gray-300",
                  selected === quizz.id &&
                    "bg-primary border-primary/80 shadow-inset",
                )}
              ></div>
            </button>
          ))}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImport}
      />
      <Button
        onClick={handleOpenImport}
        className="bg-gray-200 text-gray-800"
        disabled={isImporting}
      >
        {isImporting ? "Importing..." : "Import quizz"}
      </Button>
      <Button onClick={handleSubmit}>Submit</Button>
    </div>
  )
}

export default SelectQuizz
