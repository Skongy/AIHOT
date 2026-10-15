/** Steam header thumbs for the intro photo wall (center-cropped 16:9, ~480×270). */
export type IntroThumb = {
  src: string;
  /** Short label for alt text */
  alt: string;
};

export const INTRO_THUMBS: IntroThumb[] = [
  { src: "/intro/Among_Us.jpg", alt: "Among Us" },
  { src: "/intro/Apex_Legends.jpg", alt: "Apex Legends" },
  { src: "/intro/Baldurs_Gate_3.jpg", alt: "Baldur's Gate 3" },
  { src: "/intro/Black_Myth_Wukong.jpg", alt: "Black Myth: Wukong" },
  { src: "/intro/Counter-Strike_2.jpg", alt: "Counter-Strike 2" },
  { src: "/intro/Cyberpunk_2077.jpg", alt: "Cyberpunk 2077" },
  { src: "/intro/Dead_by_Daylight.jpg", alt: "Dead by Daylight" },
  { src: "/intro/Dota_2.jpg", alt: "Dota 2" },
  { src: "/intro/Elden_Ring.jpg", alt: "Elden Ring" },
  { src: "/intro/Factorio.jpg", alt: "Factorio" },
  { src: "/intro/Fall_Guys.jpg", alt: "Fall Guys" },
  { src: "/intro/Hades.jpg", alt: "Hades" },
  { src: "/intro/Hollow_Knight.jpg", alt: "Hollow Knight" },
  { src: "/intro/Palworld.jpg", alt: "Palworld" },
  { src: "/intro/PUBG.jpg", alt: "PUBG" },
  { src: "/intro/Rainbow_Six_Siege.jpg", alt: "Rainbow Six Siege" },
  { src: "/intro/Red_Dead_Redemption_2.jpg", alt: "Red Dead Redemption 2" },
  { src: "/intro/RimWorld.jpg", alt: "RimWorld" },
  { src: "/intro/Rust.jpg", alt: "Rust" },
  { src: "/intro/Sekiro.jpg", alt: "Sekiro" },
  { src: "/intro/Slay_the_Spire_2.jpg", alt: "Slay the Spire 2" },
  { src: "/intro/Terraria.jpg", alt: "Terraria" },
  { src: "/intro/The_Witcher_3.jpg", alt: "The Witcher 3" },
];

/** ~20 thumbs for the ellipse; drop a few so the ring stays airy. */
export const INTRO_WALL = INTRO_THUMBS.filter((_, i) => ![3, 10, 21].includes(i));
