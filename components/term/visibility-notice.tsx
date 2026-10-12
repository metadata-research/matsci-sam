import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { EyeOffIcon } from "lucide-react"

export function TermVisibilityNotice({
  hiddenAt,
  reason
}: {
  hiddenAt: string | null
  reason: string | null
}) {
  if (!hiddenAt) return null
  return (
    <Alert className="my-4" role="status">
      <EyeOffIcon aria-hidden />
      <AlertTitle>Hidden from listings</AlertTitle>
      <AlertDescription>
        <p>
          This term is hidden from public discovery. Its published history
          remains available at this address.
        </p>
        {reason ? <p>Reason: {reason}</p> : null}
      </AlertDescription>
    </Alert>
  )
}
