export type SavedSignature = {
  id: string
  name: string
  dataUrl: string
}

export interface SignaturesApi {
  list(): Promise<SavedSignature[]>
  save(name: string, dataUrl: string): Promise<SavedSignature>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
}
