/**
 * Composable for uploading a file to the media API.
 *
 * Usage:
 *   const { upload, isUploading, error } = useMediaUpload()
 *   const result = await upload(file)  // { id, url }
 *
 * `error` holds the server's own message when it deliberately provided one,
 * or null otherwise — never a raw diagnostic Error message (see
 * extractServerErrorMessage). It's nullable rather than pre-filled with a
 * generic fallback so a caller can supply its own context-specific fallback
 * (e.g. "Could not upload cover") instead of a one-size-fits-all string.
 */
import { extractServerErrorMessage } from "~/utils/extractErrorMessage";

export interface MediaUploadResult {
  id: string;
  url: string;
}

export function useMediaUpload() {
  const isUploading = ref(false);
  const error = ref<string | null>(null);

  async function upload(file: File): Promise<MediaUploadResult> {
    isUploading.value = true;
    error.value = null;

    try {
      const response = await $fetch<MediaUploadResult>("/api/media", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: await file.arrayBuffer(),
      });

      return response;
    } catch (uploadError) {
      error.value = extractServerErrorMessage(uploadError);
      throw uploadError;
    } finally {
      isUploading.value = false;
    }
  }

  return { upload, isUploading, error };
}
