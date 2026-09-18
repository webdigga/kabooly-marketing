// What is happening, by how long it has been going. The model gives no
// progress of its own, so the stages follow the steps the app takes.
const STAGES = [
  { from: 0, text: 'Planning the shots and captions' },
  { from: 20, text: 'Painting the opening frame' },
  { from: 55, text: 'Filming your video' },
  { from: 180, text: 'Still filming. Longer videos can take a few minutes' },
]

export function stageAt(seconds: number): string {
  return [...STAGES].reverse().find((stage) => seconds >= stage.from)?.text ?? STAGES[0]!.text
}

export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`
}

