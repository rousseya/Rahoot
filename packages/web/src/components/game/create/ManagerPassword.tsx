import Button from "@rahoot/web/components/Button"
import Form from "@rahoot/web/components/Form"
import Input from "@rahoot/web/components/Input"
import { useEvent, useSocket } from "@rahoot/web/contexts/socketProvider"
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google"
import { KeyboardEvent, useState } from "react"
import toast from "react-hot-toast"

type Props = {
  onSubmit: (_password: string) => void
  onGoogleAuth: (_credential: string) => void
}

const ManagerPassword = ({ onSubmit, onGoogleAuth }: Props) => {
  const [password, setPassword] = useState("")
  const { googleClientId } = useSocket()

  const handleSubmit = () => {
    onSubmit(password)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      handleSubmit()
    }
  }

  useEvent("manager:errorMessage", (message) => {
    toast.error(message)
  })

  return (
    <Form>
      {googleClientId && (
        <GoogleOAuthProvider clientId={googleClientId}>
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={(response) => {
                if (response.credential) {
                  onGoogleAuth(response.credential)
                }
              }}
              onError={() => {
                toast.error("Google Sign-In failed")
              }}
              text="signin_with"
              shape="rectangular"
              width="280"
            />
          </div>
          <div className="flex items-center gap-3">
            <hr className="flex-1 border-gray-300" />
            <span className="text-sm text-gray-400">or</span>
            <hr className="flex-1 border-gray-300" />
          </div>
        </GoogleOAuthProvider>
      )}
      <Input
        type="password"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Manager password"
      />
      <Button onClick={handleSubmit}>Submit</Button>
    </Form>
  )
}

export default ManagerPassword
