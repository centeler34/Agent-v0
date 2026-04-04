import type { Command } from '../../commands.js'

const toolsInspect = {
  type: 'local',
  name: 'tools-inspect',
  description:
    'Inspect the real tool definitions sent to the Claude API — see exactly what the AI model receives',
  supportsNonInteractive: true,
  isHidden: false,
  load: () => import('./toolsInspect.js'),
} satisfies Command

export default toolsInspect
