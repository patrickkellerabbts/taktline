import { TaktMark } from '@/components/brand/TaktMark';

// Absichtlich ohne Unterscheidung: ob ein Link nie existierte, abgelaufen oder
// widerrufen ist, geht niemanden ohne gültigen Link etwas an.
export default function ShareNotFound() {
  return (
    <main className="share__invalid">
      <TaktMark size={32} />
      <h1>Dieser Link ist nicht gültig</h1>
      <p>Er ist abgelaufen oder wurde widerrufen. Bitte frag bei der Person nach, die ihn dir geschickt hat.</p>
    </main>
  );
}
