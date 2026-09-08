import { AppShell } from '@/app/AppShell'
import { useAppWorkspace } from '@/app/useAppWorkspace'

export default function App() {
  const vm = useAppWorkspace()
  return <AppShell {...vm} />
}
