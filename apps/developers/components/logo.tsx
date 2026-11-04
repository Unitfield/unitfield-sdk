/** The Unitfield wordmark in light and dark, and the name of this site. The two images swap with the theme. */
export function Logo() {
  return (
    <span className="uf-logo">
      <img className="uf-logo-light" src="/brand/unitfield-wordmark-on-light.svg" alt="Unitfield" width={94} height={23} />
      <img className="uf-logo-dark" src="/brand/unitfield-wordmark-on-dark.svg" alt="Unitfield" width={94} height={23} />
      <span className="uf-logo-name">Developers</span>
    </span>
  );
}
