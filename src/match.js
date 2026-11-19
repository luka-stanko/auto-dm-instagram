// Reconnaître un mot-clé dans un commentaire, même en majuscules, avec des accents,
// des emojis autour ou une petite faute de frappe.

export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')        // ponctuation, emojis
    .trim();
}

// Distance d'édition où deux lettres inversées (« manycaht ») comptent pour une seule faute.
function closeEnough(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length] <= max;
}

// Une faute tolérée à partir de 5 lettres, deux à partir de 9.
// En dessous, le mot doit être exact : « KIT » ne doit pas attraper « kits » ni « kitsch ».
function tolerance(word) {
  if (word.length >= 9) return 2;
  if (word.length >= 5) return 1;
  return 0;
}

export function matchKeyword(comment, keyword) {
  const text = normalize(comment);
  const key = normalize(keyword);
  if (!text || !key) return false;

  const words = text.split(' ');
  const keyWords = key.split(' ');

  // Mot-clé de plusieurs mots : on cherche la suite de mots, chacun avec sa tolérance.
  for (let i = 0; i + keyWords.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < keyWords.length && ok; k++) {
      const w = words[i + k];
      const kw = keyWords[k];
      ok = w === kw || closeEnough(w, kw, tolerance(kw));
    }
    if (ok) return true;
  }

  // Mot-clé collé sans espace (« many chat » écrit « manychat », ou l'inverse).
  const joinedKey = keyWords.join('');
  if (keyWords.length > 1 && words.includes(joinedKey)) return true;
  if (keyWords.length === 1) {
    for (let i = 0; i + 1 < words.length; i++) {
      if (words[i] + words[i + 1] === joinedKey) return true;
    }
  }
  return false;
}
