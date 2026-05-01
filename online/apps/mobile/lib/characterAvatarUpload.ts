import type { SupabaseClient } from "@supabase/supabase-js";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

const BUCKET = "character-avatars";
/** Salida cuadrada para que encaje en el retrato de la mesa (cover en UI). */
const PORTRAIT_SIZE = 512;

/**
 * Supabase documenta que en React Native `Blob`/`File` no suben bien a Storage;
 * hay que enviar `ArrayBuffer`. `fetch(file://).blob()` suele dar cuerpo vacío.
 */
function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`No se pudo leer la imagen local (HTTP ${xhr.status})`));
        return;
      }
      const buf = xhr.response as ArrayBuffer;
      if (!buf || buf.byteLength === 0) {
        reject(new Error("La imagen local quedó vacía al leerla"));
        return;
      }
      resolve(buf);
    };
    xhr.onerror = () => reject(new Error("Error de red al leer la imagen local"));
    xhr.responseType = "arraybuffer";
    xhr.open("GET", uri, true);
    xhr.send();
  });
}

async function imageUriToUploadBytes(uri: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`fetch imagen ${res.status}`);
    return await res.arrayBuffer();
  }
  try {
    return await readUriAsArrayBuffer(uri);
  } catch (e) {
    const res = await fetch(uri);
    if (!res.ok) throw e;
    return await res.arrayBuffer();
  }
}

export async function pickAndPreparePortraitJpeg(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permiso", "Se necesita acceso a la galería para elegir una imagen.");
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });

  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const uri = result.assets[0].uri;

  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: PORTRAIT_SIZE, height: PORTRAIT_SIZE } }],
    { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
  );

  return out.uri;
}

export async function uploadPortraitJpeg(
  supabase: SupabaseClient,
  userId: string,
  characterId: string,
  localFileUri: string,
): Promise<string> {
  const path = `${userId}/${characterId}.jpg`;
  const bytes = await imageUriToUploadBytes(localFileUri);
  if (bytes.byteLength < 64) {
    throw new Error("La foto no se leyó bien desde el dispositivo; probá elegirla de nuevo.");
  }

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
