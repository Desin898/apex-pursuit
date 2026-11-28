// 5C: credits for the third-party art in the game, word for word from each pack's license.txt.
// While the sky pano (CC-BY-NC-SA-4.0) is in the game, the game must stay non-commercial.
export const CREDITS: { what: string; line: string; url: string }[] = [
  {
    what: 'Hanagiri spruces and bare birches',
    line: 'This work is based on "Snow Pine Tree and Bush Pack LOWPOLY" (https://sketchfab.com/3d-models/snow-pine-tree-and-bush-pack-lowpoly-7afc4ca23dd84adea90dc0ba8506c500) by EFX (https://sketchfab.com/evan4129) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    url: 'https://sketchfab.com/3d-models/snow-pine-tree-and-bush-pack-lowpoly-7afc4ca23dd84adea90dc0ba8506c500',
  },
  {
    what: 'Hanagiri cherry trees',
    line: 'This work is based on "Sakura Tree 01 - Low Poly Model" (https://sketchfab.com/3d-models/sakura-tree-01-low-poly-model-147ae7d0d332456a99ec6195e9b0cd4f) by Jogoss (https://sketchfab.com/thejogoss9) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    url: 'https://sketchfab.com/3d-models/sakura-tree-01-low-poly-model-147ae7d0d332456a99ec6195e9b0cd4f',
  },
  {
    what: 'Snow-weather reflections and tree line',
    line: 'This work is based on "Sky Pano - Winter Forest" (https://sketchfab.com/3d-models/sky-pano-winter-forest-b42c27358ab04e8885ffb2ecf69c352c) by MozillaHubs (https://sketchfab.com/mozillareality) licensed under CC-BY-NC-SA-4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)',
    url: 'https://sketchfab.com/3d-models/sky-pano-winter-forest-b42c27358ab04e8885ffb2ecf69c352c',
  },
];

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The About page's body: the game, then the credits. */
export function creditsHtml(): string {
  return (
    `<div class="credits"><p>Apex Pursuit: a browser street racer by Desindu Pannilage. Cars, tracks, music packs and code are our own unless credited here.</p>` +
    CREDITS.map((c) => `<p><b>${esc(c.what)}</b><br><span>${esc(c.line)}</span></p>`).join('') +
    `<p><b>Licences</b><br><span>The sky pano is CC-BY-NC-SA-4.0: while it is in the game, Apex Pursuit stays non-commercial.</span></p></div>`
  );
}
