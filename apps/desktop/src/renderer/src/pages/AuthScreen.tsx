import { SignIn } from '@clerk/clerk-react'

interface AuthScreenProps {
  onSkip: () => void
}

export default function AuthScreen({ onSkip }: AuthScreenProps): JSX.Element {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-950">
      <SignIn routing="hash" />
      <button
        type="button"
        onClick={onSkip}
        className="mt-6 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Ohne Account starten
      </button>
    </div>
  )
}
