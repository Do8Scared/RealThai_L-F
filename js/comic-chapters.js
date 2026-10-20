export const COMIC_CHAPTERS = Array.from({ length: 8 }, (_, index) => ({
  number: index + 1,
  title: `Chapter ${index + 1}`,
  cover: '',
  pages: [],
}));
