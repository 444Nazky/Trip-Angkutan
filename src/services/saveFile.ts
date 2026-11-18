import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Plugin native untuk menyimpan file lewat file manager Android
 * (Storage Access Framework / ACTION_CREATE_DOCUMENT).
 */
interface SaveFilePlugin {
  saveJson(options: { filename: string; data: string }): Promise<{ uri: string; name: string }>
}

const SaveFile = registerPlugin<SaveFilePlugin>('SaveFile')

export interface SaveFileResult {
  uri: string
  name: string
}

export function canPickSaveLocation(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

export function saveJsonWithPicker(filename: string, data: string): Promise<SaveFileResult> {
  return SaveFile.saveJson({ filename, data })
}
