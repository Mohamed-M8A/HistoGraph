export async function loadConfig() {
  const res = await fetch(new URL("../config.json", import.meta.url));
  return res.json();
}
