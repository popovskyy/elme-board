import { redirect } from 'next/navigation';

// The board UI is the static page ported from the claude.ai artifact (public/board/index.html).
// TODO(Cursor, optional): port it to React components once the data layer is final.
export default function Home() {
  redirect('/board/index.html');
}
