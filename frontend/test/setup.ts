import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// happy-dom never loads images, so anything drawing one (the brand strip,
// carousel slides) would wait for ever. Tests that care about sizes stub
// their own.
class TestImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 400
  naturalHeight = 100
  set src(_value: string) {
    setTimeout(() => this.onload?.())
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', TestImage)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})
