/** "Powered by Tachyon", fixed to the bottom-left corner of every screen. */
export default function PoweredBy() {
  return (
    <div className="powered" aria-label="Powered by Tachyon">
      <span>Powered by</span>
      <img src="/tachyon-logo.jpg" alt="Tachyon" />
    </div>
  );
}
