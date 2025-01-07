import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { createGenericFile, GenericFile } from '@metaplex-foundation/umi';

export const base64ToGenericFile = (base64String: string, fileName: string): GenericFile => {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  
    return createGenericFile(bytes, fileName, {
      contentType: 'image/png',
      extension: 'png',
    });
};

// note: read images from folder, and sort by number
export const readImagesFromFolder = (folderPath: string): Buffer[] => {
  const files = readdirSync(folderPath)
    .filter(file => /^\d+\.(jpg|jpeg|png)$/i.test(file))
    .map(file => readFileSync(path.join(folderPath, file)));
  
  if (files.length === 0) {
    throw new Error('No image files found in media folder');
  }
  return files;
}; 