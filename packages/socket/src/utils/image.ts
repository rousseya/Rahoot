import env from "@rahoot/socket/env";

/**
 * Resolves an image path to a full URL.
 * If the path is already a full URL (http/https), it returns as-is.
 * If the path starts with "images/", it converts to a socket server URL.
 */
export function resolveImageUrl(
  imagePath: string | undefined,
): string | undefined {
  if (!imagePath) {
    return undefined;
  }

  // Already a full URL
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }

  // Convert relative path to socket server URL
  // The socket server serves images at /images/{path}
  // The image path in config is "images/Quiz_Name/file.png"
  // So we need to serve it at SOCKET_URL/images/Quiz_Name/file.png
  return `${env.SOCKET_URL}/${imagePath}`;
}
