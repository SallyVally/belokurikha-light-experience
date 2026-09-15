"use client";

import { useGLTF, useProgress, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ArrowRight,
  ChevronRight,
  CookingPot,
  Maximize2,
  Minimize2,
  Moon,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Video,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Points as ThreePoints,
  RectAreaLight,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Shape,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Slider } from "@/components/ui/slider";

type SceneMode = "morning" | "evening" | "cinema" | "night";
type AssetTier = "premium" | "mobile";
type RoomView = "bedroom" | "kitchen";
type AssistantIntent = "wake" | "view" | "return" | "sleep" | "open" | "close" | "cinema" | "evening" | "morning" | "night";

type AssistantMessage = {
  prompt: string;
  response: string;
};

const assistantSuggestions: Array<{ intent: AssistantIntent; prompt: string }> = [
  { intent: "wake", prompt: "Разбуди меня мягко" },
  { intent: "view", prompt: "Покажи вид на горы" },
  { intent: "return", prompt: "Я вернулся в номер" },
];

function parseAssistantIntent(input: string): AssistantIntent | null {
  const phrase = input.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  if (/разбуд|просып|плавн.*утр|мягк.*утр/.test(phrase)) return "wake";
  if (/вид|панорам|гор[ыу]|кухн/.test(phrase)) return "view";
  if (/вернул|пришел|дома|уютн.*номер/.test(phrase)) return "return";
  if (/спать|уснуть|ко сну|спокойн.*ноч/.test(phrase)) return "sleep";
  if (/штор/.test(phrase) && /откр|раздвин/.test(phrase)) return "open";
  if (/штор/.test(phrase) && /закр|задвин/.test(phrase)) return "close";
  if (/кин[оо]|фильм/.test(phrase)) return "cinema";
  if (/вечер/.test(phrase)) return "evening";
  if (/утро/.test(phrase)) return "morning";
  if (/ноч/.test(phrase)) return "night";
  return null;
}

const SCENE_ASSET_REVISION = "2026-09-13-living-scene";
const CURTAIN_PANEL_X = 2.63;
const CURTAIN_RAIL_X = 2.66;

type ExperienceState = {
  mode: SceneMode;
  curtain: number;
  parallax: boolean;
};

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

type WebMcpContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

// The UE actor transform does not share the final GLB's baked Blender basis.
// These anchors are measured against the exported room: camera clear of the
// corridor wall, target on the bedroom window, bed held in the right foreground.
const WEB_CAMERA = {
  position: [7.35, 1.72, -3.75] as [number, number, number],
  target: [2.55, 1.72, -6] as [number, number, number],
  verticalFov: 48.897158,
};

const KITCHEN_CAMERA = {
  position: new Vector3(5.5, 1.75, -14),
  target: new Vector3(4.3, 1.7, -20),
};

const sceneModes: Array<{
  id: SceneMode;
  label: string;
  note: string;
  icon: typeof SunMedium;
}> = [
  { id: "morning", label: "Утро", note: "Дневной свет", icon: SunMedium },
  { id: "evening", label: "Вечер", note: "Тёплый свет", icon: Sparkles },
  { id: "cinema", label: "Кино", note: "Приглушённый свет", icon: Video },
  { id: "night", label: "Ночь", note: "Вид на звёзды", icon: Moon },
];

const modeProfile: Record<
  SceneMode,
  {
    background: string;
    environment: number;
    exposure: number;
    key: number;
    practical: number;
    emissive: number;
    bloom: number;
    glare: number;
    warmth: string;
    exteriorTint: string;
    ridgeTint: string;
    landscapeMix: [number, number, number];
  }
> = {
  morning: {
    background: "#777c7b",
    environment: 0.48,
    exposure: 0.94,
    key: 1.15,
    practical: 0.2,
    emissive: 0.05,
    bloom: 0.18,
    glare: 0.28,
    warmth: "#fff1db",
    exteriorTint: "#fffaf2",
    ridgeTint: "#315342",
    landscapeMix: [1, 0, 0],
  },
  evening: {
    background: "#4a2b1d",
    environment: 0.48,
    exposure: 1.34,
    key: 1.05,
    practical: 1,
    emissive: 0.72,
    bloom: 0.76,
    glare: 0.7,
    warmth: "#ffd6a4",
    exteriorTint: "#ffe0bd",
    ridgeTint: "#3b3d2d",
    landscapeMix: [0, 1, 0],
  },
  cinema: {
    background: "#120d0c",
    environment: 0.25,
    exposure: 1.18,
    key: 0.28,
    practical: 0.52,
    emissive: 0.42,
    bloom: 0.92,
    glare: 0.08,
    warmth: "#dba47a",
    exteriorTint: "#b9c2d0",
    ridgeTint: "#1a211e",
    landscapeMix: [0, 0.38, 0.62],
  },
  night: {
    background: "#070808",
    environment: 0.16,
    exposure: 1.13,
    key: 0.1,
    practical: 0.34,
    emissive: 0.28,
    bloom: 0.58,
    glare: 0,
    warmth: "#d98c56",
    exteriorTint: "#a9c4eb",
    ridgeTint: "#0d1718",
    landscapeMix: [0, 0, 1],
  },
};

const modeCurtainPresets: Record<SceneMode, number> = {
  morning: 100,
  evening: 78,
  cinema: 0,
  night: 12,
};

function getWindowLight(curtain: number) {
  const open = MathUtils.clamp(curtain / 100, 0, 1);
  const sky = MathUtils.smoothstep(open, 0, 1);
  const sun = Math.pow(MathUtils.smoothstep(open, 0.08, 1), 1.45);
  return { open, sky, sun };
}

function getCloudTransmission(time: number) {
  const broad = 0.5 + 0.5 * Math.sin(time * 0.19 - 0.9);
  const detail = 0.5 + 0.5 * Math.sin(time * 0.31 + 1.4);
  return 0.82 + 0.18 * (broad * 0.72 + detail * 0.28);
}

// A conservative skyline traced from the existing valley panorama. Keeping
// stars above this line prevents them from drifting across mountains.
const skylineAnchors: Array<[number, number]> = [
  [0, 0.76], [0.06, 0.76], [0.12, 0.75], [0.18, 0.735],
  [0.24, 0.73], [0.3, 0.71], [0.36, 0.705], [0.42, 0.72],
  [0.48, 0.715], [0.54, 0.705], [0.6, 0.695], [0.66, 0.69],
  [0.72, 0.705], [0.78, 0.705], [0.84, 0.71], [0.9, 0.7],
  [0.96, 0.71], [1, 0.715],
];

function getSkyline(x: number) {
  const clamped = MathUtils.clamp(x, 0, 1);
  for (let index = 1; index < skylineAnchors.length; index += 1) {
    const [rightX, rightY] = skylineAnchors[index];
    if (clamped > rightX) continue;
    const [leftX, leftY] = skylineAnchors[index - 1];
    return MathUtils.lerp(leftY, rightY, (clamped - leftX) / (rightX - leftX));
  }
  return skylineAnchors[skylineAnchors.length - 1][1];
}

const practicalMaterialNames = new Set([
  "H_light",
  "LED-Lighitng.001",
  "LIGHT on.001",
  "Lamp",
  "Light Led",
  "Light Soft.001",
  "Light Strong.001",
  "Shelf Light.001",
  "matte light",
]);

const sceneShots: Record<SceneMode, { position: Vector3; target: Vector3 }> = {
  morning: {
    position: new Vector3(7.28, 1.78, -3.65),
    target: new Vector3(2.45, 1.76, -5.92),
  },
  evening: {
    position: new Vector3(...WEB_CAMERA.position),
    target: new Vector3(...WEB_CAMERA.target),
  },
  cinema: {
    position: new Vector3(7.45, 1.68, -3.82),
    target: new Vector3(2.65, 1.68, -6.12),
  },
  night: {
    position: new Vector3(7.4, 1.65, -3.88),
    target: new Vector3(2.55, 1.66, -6.05),
  },
};

const sceneSunPositions: Record<SceneMode, Vector3> = {
  morning: new Vector3(-6.4, 10.2, -3.3),
  evening: new Vector3(-5.8, 5.4, -2.65),
  cinema: new Vector3(-4.8, 2.6, -2.2),
  night: new Vector3(-3.6, 7.2, -8.4),
};

const cameraFlareProfile: Record<
  SceneMode,
  { opacity: number; x: number; y: number }
> = {
  morning: { opacity: 0.28, x: 59, y: 23 },
  evening: { opacity: 0.82, x: 61, y: 33 },
  cinema: { opacity: 0.035, x: 69, y: 42 },
  night: { opacity: 0, x: 78, y: 14 },
};

function kelvinToColor(kelvin: number) {
  if (kelvin >= 5000) return "#fff4df";
  return "#ffd2a0";
}

function AreaLight({
  height = 0.08,
  intensity,
  position,
  target,
  temperature,
  width,
}: {
  height?: number;
  intensity: number;
  position: [number, number, number];
  target?: [number, number, number];
  temperature: number;
  width: number;
}) {
  const light = useRef<RectAreaLight>(null);
  const animatedIntensity = useRef(intensity);

  useLayoutEffect(() => {
    light.current?.lookAt(
      target?.[0] ?? position[0],
      target?.[1] ?? position[1] - 1,
      target?.[2] ?? position[2],
    );
  }, [position, target]);

  useFrame((_, delta) => {
    animatedIntensity.current = MathUtils.damp(
      animatedIntensity.current,
      intensity,
      1.45,
      delta,
    );
    if (light.current) light.current.intensity = animatedIntensity.current;
  });

  return (
    <rectAreaLight
      ref={light}
      color={kelvinToColor(temperature)}
      intensity={intensity}
      position={position}
      width={width}
      height={height}
    />
  );
}

function SceneBackdrop({ mode }: { mode: SceneMode }) {
  const { scene } = useThree();
  const color = useRef(new Color(modeProfile[mode].background));
  const target = useMemo(() => new Color(modeProfile[mode].background), [mode]);

  useLayoutEffect(() => {
    scene.background = color.current;
    return () => {
      scene.background = null;
    };
  }, [scene]);

  useFrame((_, delta) => {
    color.current.lerp(target, 1 - Math.exp(-delta * 1.35));
  });

  return null;
}

function SceneEnvironment({ curtain, mode }: { curtain: number; mode: SceneMode }) {
  const { gl, scene } = useThree();
  const profile = modeProfile[mode];
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const animatedProfile = useRef({
    environment: profile.environment,
    exposure: profile.exposure,
  });

  useEffect(() => {
    RectAreaLightUniformsLib.init();
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04).texture;
    // Three.js scene state is intentionally configured imperatively.
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = environment;
    return () => {
      scene.environment = null;
      environment.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  // Three.js exposes live renderer and scene controls for per-frame animation.
  // eslint-disable-next-line react-hooks/immutability
  useFrame((_, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.8,
      delta,
    );
    const { sky } = getWindowLight(animatedOpen.current * 100);
    animatedProfile.current.environment = MathUtils.damp(
      animatedProfile.current.environment,
      profile.environment,
      1.35,
      delta,
    );
    animatedProfile.current.exposure = MathUtils.damp(
      animatedProfile.current.exposure,
      profile.exposure,
      1.35,
      delta,
    );
    // eslint-disable-next-line react-hooks/immutability
    scene.environmentIntensity = animatedProfile.current.environment * (0.14 + sky * 0.28);
    // eslint-disable-next-line react-hooks/immutability
    gl.toneMappingExposure = animatedProfile.current.exposure * (0.92 + sky * 0.08);
  });

  return null;
}

function BloomPipeline({ mode }: { mode: SceneMode }) {
  const { camera, gl, scene, size } = useThree();
  const profile = modeProfile[mode];
  const composer = useMemo(() => new EffectComposer(gl), [gl]);
  const bloom = useMemo(
    () => new UnrealBloomPass(new Vector2(1, 1), 0, 0.72, 0.78),
    [],
  );

  useEffect(() => {
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return () => composer.dispose();
  }, [bloom, camera, composer, scene]);

  useEffect(() => {
    composer.setPixelRatio(Math.min(gl.getPixelRatio(), 1.35));
    composer.setSize(size.width, size.height);
  }, [composer, gl, size]);

  useFrame((_, delta) => {
    bloom.strength = MathUtils.damp(bloom.strength, profile.bloom, 1.4, delta);
    bloom.radius = MathUtils.damp(bloom.radius, mode === "night" ? 0.82 : 0.68, 1.4, delta);
    bloom.threshold = MathUtils.damp(
      bloom.threshold,
      mode === "morning" ? 0.88 : 0.72,
      1.4,
      delta,
    );
    composer.render();
  }, 1);
  return null;
}

const landscapeVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function createMistTexture() {
  const width = 128;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  const hash = (x: number, y: number) => {
    let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (u: number, v: number, columns: number, rows: number) => {
    const x = u * columns;
    const y = v * rows;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = (x - ix) ** 2 * (3 - 2 * (x - ix));
    const fy = (y - iy) ** 2 * (3 - 2 * (y - iy));
    const left = ix % columns;
    const right = (ix + 1) % columns;
    const bottom = iy % rows;
    const top = (iy + 1) % rows;
    const lower = MathUtils.lerp(hash(left, bottom), hash(right, bottom), fx);
    const upper = MathUtils.lerp(hash(left, top), hash(right, top), fx);
    return MathUtils.lerp(lower, upper, fy);
  };

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const u = column / width;
      const v = row / height;
      const value = Math.round((
        noise(u, v, 4, 3) * 0.57 +
        noise(u, v, 9, 6) * 0.31 +
        noise(u, v, 18, 12) * 0.12
      ) * 255);
      const offset = (row * width + column) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const landscapeFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uLandscape;
  uniform sampler2D uMist;
  uniform sampler2D uSkyline;
  uniform float uMistDetail;
  uniform vec3 uWeights;
  uniform vec3 uTint;
  uniform vec2 uParallax;
  uniform float uBrightness;
  uniform float uTime;

  void main() {
    float nearField = 1.0 - smoothstep(0.12, 0.88, vUv.y);
    vec2 sampleUv = clamp(vUv + uParallax * nearField, vec2(0.002), vec2(0.998));
    vec3 source = texture2D(uLandscape, sampleUv).rgb;
    float luminance = dot(source, vec3(0.2126, 0.7152, 0.0722));
    float skyline = texture2D(uSkyline, vec2(sampleUv.x, 0.5)).r;
    float skyMask = smoothstep(skyline - 0.012, skyline + 0.025, sampleUv.y);

    // Every time of day is graded from the same pixels so mountains and
    // buildings never morph between independently generated images.
    vec3 morning = source * vec3(0.91, 0.97, 1.055);
    morning = mix(morning, vec3(luminance), 0.045) + vec3(0.018, 0.024, 0.032);

    vec3 evening = source * vec3(1.035, 0.985, 0.91);
    evening = mix(evening, evening * evening, 0.08);

    vec3 night = pow(max(source, vec3(0.0)), vec3(1.18)) * vec3(0.055, 0.095, 0.17);
    float skyHeight = clamp((sampleUv.y - skyline) / max(1.0 - skyline, 0.12), 0.0, 1.0);
    vec3 nightSky = mix(vec3(0.028, 0.055, 0.104), vec3(0.005, 0.013, 0.036), skyHeight);
    night = mix(night, nightSky + source * 0.012, skyMask * 0.94);
    float cityBand = smoothstep(0.1, 0.22, vUv.y) * (1.0 - smoothstep(0.47, 0.58, vUv.y));
    float cityLights = smoothstep(0.74, 0.96, luminance) * cityBand;
    night += vec3(1.0, 0.48, 0.16) * cityLights * 1.65;

    vec3 landscape = morning * uWeights.x + evening * uWeights.y + night * uWeights.z;
    float cloudField = sin(sampleUv.x * 11.0 - uTime * 0.12) *
      sin(sampleUv.y * 4.8 + sampleUv.x * 2.1 - uTime * 0.025);
    float cloudShadow = smoothstep(-0.1, 0.82, cloudField);
    landscape *= 1.0 - (uWeights.x + uWeights.y) * (1.0 - skyMask) * cloudShadow * 0.13;

    // Only the light veil in the distant valleys moves; the photographic
    // mountain contours, trees and buildings stay fixed in the source image.
    float valleyCenter = 0.435 + 0.045 * sin(sampleUv.x * 7.0 - 0.5);
    float valleyBand = 1.0 - smoothstep(0.018, 0.078, abs(sampleUv.y - valleyCenter));
    float valleyReach = smoothstep(0.38, 0.49, sampleUv.x) *
      (1.0 - smoothstep(0.79, 0.96, sampleUv.x));
    float mistA = texture2D(uMist, vec2(sampleUv.x * 1.35 + uTime * 0.005, sampleUv.y * 2.4)).r;
    float mistB = 0.5;
    if (uMistDetail > 0.5) {
      mistB = texture2D(uMist, vec2(sampleUv.x * 2.1 - uTime * 0.0025, sampleUv.y * 3.2 + 0.37)).r;
    }
    float mistShape = smoothstep(0.34, 0.69, mistA * 0.72 + mistB * 0.28);
    float mistAmount = valleyBand * valleyReach * mistShape *
      (uWeights.x * 0.25 + uWeights.y * 0.29 + uWeights.z * 0.055);
    vec3 mistColor = uWeights.x * vec3(0.66, 0.72, 0.76) +
      uWeights.y * vec3(0.8, 0.7, 0.61) + uWeights.z * vec3(0.18, 0.23, 0.3);
    landscape = mix(landscape, mistColor, mistAmount);
    gl_FragColor = vec4(landscape * uTint * uBrightness, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function ExteriorEnvironment({
  curtain,
  mode,
  room,
  tier,
}: {
  curtain: number;
  mode: SceneMode;
  room: RoomView;
  tier: AssetTier;
}) {
  const profile = modeProfile[mode];
  const suffix = tier === "premium" ? "2048" : "1280";
  const texturePath = useMemo(
    () => `/environments/belokurikha-valley-${suffix}.webp?rev=${SCENE_ASSET_REVISION}`,
    [suffix],
  );
  const sourceTexture = useTexture(texturePath);
  const landscapeTexture = useMemo(
    () => {
      const next = sourceTexture.clone();
      next.colorSpace = SRGBColorSpace;
      next.anisotropy = tier === "premium" ? 8 : 2;
      next.needsUpdate = true;
      return next;
    },
    [sourceTexture, tier],
  );
  const skylineTexture = useMemo(() => {
    const width = 128;
    const data = new Uint8Array(width * 4);
    for (let index = 0; index < width; index += 1) {
      const value = Math.round(getSkyline(index / (width - 1)) * 255);
      data[index * 4] = value;
      data[index * 4 + 1] = value;
      data[index * 4 + 2] = value;
      data[index * 4 + 3] = 255;
    }
    const texture = new DataTexture(data, width, 1, RGBAFormat);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }, []);
  const mistTexture = useMemo(createMistTexture, []);
  const targetWeights = useMemo(
    () => new Vector3(...profile.landscapeMix),
    [profile.landscapeMix],
  );
  const targetTint = useMemo(() => new Color(profile.exteriorTint), [profile.exteriorTint]);
  const animatedWeights = useRef(targetWeights.clone());
  const animatedTint = useRef(targetTint.clone());
  const animatedParallax = useRef(new Vector2());
  const parallaxTarget = useMemo(() => new Vector2(), []);
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const motionAllowed = useRef(true);
  const landscapeMaterial = useMemo(
    () => new ShaderMaterial({
      depthWrite: true,
      fragmentShader: landscapeFragmentShader,
      toneMapped: true,
      uniforms: {
        uBrightness: { value: 1 },
        uLandscape: { value: landscapeTexture },
        uMist: { value: mistTexture },
        uMistDetail: { value: tier === "premium" ? 1 : 0 },
        uSkyline: { value: skylineTexture },
        uParallax: { value: new Vector2() },
        uTint: { value: animatedTint.current.clone() },
        uTime: { value: 0 },
        uWeights: { value: animatedWeights.current.clone() },
      },
      vertexShader: landscapeVertexShader,
    }),
    [landscapeTexture, mistTexture, skylineTexture],
  );

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { motionAllowed.current = !preference.matches; };
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  // The landscape material is intentionally animated by the render loop.
  useFrame(({ camera, clock }, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.6,
      delta,
    );
    animatedWeights.current.lerp(targetWeights, 1 - Math.exp(-delta * 1.35));
    animatedTint.current.lerp(targetTint, 1 - Math.exp(-delta * 1.35));
    parallaxTarget.set(
      (camera.position.z - (room === "kitchen" ? KITCHEN_CAMERA.position.z : WEB_CAMERA.position[2])) * 0.013,
      (camera.position.y - WEB_CAMERA.position[1]) * -0.01,
    );
    animatedParallax.current.lerp(parallaxTarget, 1 - Math.exp(-delta * 2.2));
    const brightness = 0.18 + Math.pow(animatedOpen.current, 0.72) * 0.82;
    landscapeMaterial.uniforms.uBrightness.value = brightness;
    landscapeMaterial.uniforms.uParallax.value.copy(animatedParallax.current);
    landscapeMaterial.uniforms.uTint.value.copy(animatedTint.current);
    landscapeMaterial.uniforms.uWeights.value.copy(animatedWeights.current);
    landscapeMaterial.uniforms.uMistDetail.value = tier === "premium" ? 1 : 0;
    if (motionAllowed.current) landscapeMaterial.uniforms.uTime.value = clock.elapsedTime;
  });

  useEffect(
    () => () => {
      landscapeTexture.dispose();
      mistTexture.dispose();
      skylineTexture.dispose();
      landscapeMaterial.dispose();
    },
    [landscapeMaterial, landscapeTexture, mistTexture, skylineTexture],
  );

  return (
    <group>
      <mesh
        material={landscapeMaterial}
        position={room === "kitchen" ? [2.3, 1.72, -22.45] : [-8, 1.72, -10.95]}
        rotation={[0, room === "kitchen" ? 0.81 : Math.PI / 2, 0]}
      >
        <planeGeometry args={[22, 8.5]} />
      </mesh>
    </group>
  );
}

function getCurtainAnchor(side: "near" | "far") {
  return side === "near" ? -3.52 : -7.58;
}

function createCurtainPositions(
  side: "near" | "far",
  open: number,
  columns: number,
  rows: number,
  tier: AssetTier,
) {
  const direction = side === "near" ? -1 : 1;
  const span = MathUtils.lerp(2.06, tier === "premium" ? 0.5 : 0.56, open);
  const folds = tier === "premium" ? 8 : 5;
  const amplitude = MathUtils.lerp(0.055, 0.09, open);
  const height = 2.91 - 1.015;
  const positions: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const fold = Math.sin(u * folds * Math.PI * 2 + (side === "far" ? Math.PI : 0));
      const body = Math.sin(v * Math.PI);
      const x = fold * amplitude * (0.82 + body * 0.18) + body * 0.012;
      const y = -height + height * v + (1 - v) * fold * 0.009;
      const z = direction * u * span;
      positions.push(x, y, z);
    }
  }

  return positions;
}

function createCurtainGeometry(side: "near" | "far", tier: AssetTier) {
  const columns = tier === "premium" ? 34 : 18;
  const rows = tier === "premium" ? 24 : 12;
  const closedPositions = createCurtainPositions(side, 0, columns, rows, tier);
  const openPositions = createCurtainPositions(side, 1, columns, rows, tier);
  const wavePositions = [0, Math.PI / 2].map((phase) => {
    const positions = [...closedPositions];
    const direction = side === "near" ? -1 : 1;

    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      const looseness = Math.pow(1 - v, 1.18);

      for (let column = 0; column <= columns; column += 1) {
        const u = column / columns;
        const index = (row * (columns + 1) + column) * 3;
        const travelingWave = Math.sin(v * Math.PI * 2.35 + u * Math.PI * 0.7 + phase);
        const trailingWave = Math.cos(v * Math.PI * 1.45 - u * Math.PI * 1.1 + phase);

        positions[index] += travelingWave * looseness * 0.068;
        positions[index + 2] += trailingWave * looseness * 0.024 * direction;
      }
    }

    return new Float32BufferAttribute(positions, 3);
  });
  const indices: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(closedPositions, 3));
  geometry.morphAttributes.position = [
    new Float32BufferAttribute(openPositions, 3),
    ...wavePositions,
  ];
  geometry.morphTargetsRelative = false;
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function CurtainPanel({
  curtain,
  mode,
  side,
  tier,
}: {
  curtain: number;
  mode: SceneMode;
  side: "near" | "far";
  tier: AssetTier;
}) {
  const initialOpen = getWindowLight(curtain).open;
  const geometry = useMemo(() => createCurtainGeometry(side, tier), [side, tier]);
  const mesh = useRef<Mesh>(null);
  const motion = useRef({
    value: initialOpen,
    velocity: 0,
    waveEnergy: 0,
    lastTarget: initialOpen,
  });
  const color = {
    morning: "#725a4b",
    evening: "#5b4034",
    cinema: "#362925",
    night: "#292526",
  }[mode];

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    mesh.current?.updateMorphTargets();
    if (mesh.current?.morphTargetInfluences) {
      mesh.current.morphTargetInfluences[0] = motion.current.value;
      mesh.current.morphTargetInfluences[1] = 0;
      mesh.current.morphTargetInfluences[2] = 0;
    }
  }, [geometry]);

  useFrame(({ clock }, delta) => {
    if (!mesh.current?.morphTargetInfluences) return;
    const target = getWindowLight(curtain).open;
    const dt = Math.min(delta, 0.035);
    const stiffness = side === "near" ? 36 : 27;
    const damping = side === "near" ? 6.4 : 5.6;
    const state = motion.current;
    const targetImpulse = Math.abs(target - state.lastTarget);
    state.lastTarget = target;
    state.velocity += (target - state.value) * stiffness * dt;
    state.velocity *= Math.exp(-damping * dt);
    state.value = MathUtils.clamp(state.value + state.velocity * dt, -0.025, 1.025);
    state.waveEnergy = Math.max(
      state.waveEnergy,
      Math.min(1, targetImpulse * 5.5 + Math.abs(state.velocity) * 0.24),
    );
    state.waveEnergy *= Math.exp(-1.55 * dt);

    mesh.current.morphTargetInfluences[0] = state.value;
    const phase = side === "near" ? 0 : 0.72;
    const motionTime = clock.elapsedTime * (side === "near" ? 3.25 : 2.8) + phase;
    const idlePhase = clock.elapsedTime * (side === "near" ? 0.82 : 0.69) + phase;
    const idleEnergy = (mode === "night" ? 0.06 : 0.08) * (0.65 + state.value * 0.35);
    mesh.current.morphTargetInfluences[1] =
      Math.sin(motionTime) * state.waveEnergy * 0.82 + Math.sin(idlePhase) * idleEnergy;
    mesh.current.morphTargetInfluences[2] =
      Math.cos(motionTime * 0.87) * state.waveEnergy * 0.58 +
      Math.cos(idlePhase * 0.81) * idleEnergy * 0.65;
    mesh.current.rotation.x =
      Math.sin(motionTime * 0.72) * state.waveEnergy * 0.018 + Math.sin(idlePhase) * 0.0015;
    mesh.current.rotation.z = Math.cos(motionTime * 0.61) * state.waveEnergy * 0.007;
  });

  return (
    <mesh
      ref={mesh}
      castShadow={tier === "premium"}
      geometry={geometry}
      position={[CURTAIN_PANEL_X, 2.91, getCurtainAnchor(side)]}
      receiveShadow={tier === "premium"}
    >
      <meshStandardMaterial
        color={color}
        envMapIntensity={0.16}
        metalness={0}
        roughness={0.92}
        side={DoubleSide}
      />
    </mesh>
  );
}

function CurtainSystem({
  curtain,
  mode,
  tier,
}: {
  curtain: number;
  mode: SceneMode;
  tier: AssetTier;
}) {
  return (
    <group>
      <mesh
        castShadow={tier === "premium"}
        position={[CURTAIN_RAIL_X, 2.945, -5.55]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[0.026, 0.026, 4.5, tier === "premium" ? 18 : 10]} />
        <meshStandardMaterial color="#3d3029" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[CURTAIN_RAIL_X, 2.945, -3.28]}>
        <sphereGeometry args={[0.055, 12, 8]} />
        <meshStandardMaterial color="#3d3029" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[CURTAIN_RAIL_X, 2.945, -7.82]}>
        <sphereGeometry args={[0.055, 12, 8]} />
        <meshStandardMaterial color="#3d3029" metalness={0.72} roughness={0.28} />
      </mesh>
      <CurtainPanel curtain={curtain} mode={mode} side="near" tier={tier} />
      <CurtainPanel curtain={curtain} mode={mode} side="far" tier={tier} />
    </group>
  );
}

const glareVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function makeGlareMaterial(kind: "floor" | "window") {
  const fragmentShader = kind === "floor"
    ? `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float edgeX = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, 1.0 - vUv.x);
        float edgeY = smoothstep(0.0, 0.28, vUv.y) * smoothstep(0.0, 0.28, 1.0 - vUv.y);
        float streak = 0.76 + 0.24 * pow(max(sin((vUv.y * 3.2 + vUv.x * 0.55) * 3.14159), 0.0), 5.0);
        gl_FragColor = vec4(uColor, edgeX * edgeY * streak * uOpacity);
      }
    `
    : `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        p.x *= 0.82;
        float halo = pow(max(1.0 - length(p), 0.0), 2.4);
        gl_FragColor = vec4(uColor, halo * uOpacity);
      }
    `;

  return new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fragmentShader,
    polygonOffset: kind === "floor",
    polygonOffsetFactor: -2,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
    uniforms: {
      uColor: { value: new Color("#ffd6a5") },
      uOpacity: { value: 0 },
    },
    vertexShader: glareVertexShader,
  });
}

function SunGlare({ curtain, mode, tier }: { curtain: number; mode: SceneMode; tier: AssetTier }) {
  const profile = modeProfile[mode];
  const floorMaterial = useMemo(() => makeGlareMaterial("floor"), []);
  const windowMaterial = useMemo(() => makeGlareMaterial("window"), []);
  const floorPatch = useRef<Mesh>(null);
  const windowGlow = useRef<Mesh>(null);
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const animatedGlare = useRef(profile.glare);
  const targetWarmth = useMemo(() => new Color(profile.warmth), [profile.warmth]);

  // Shader uniforms are intentionally mutated by the render loop.
  // eslint-disable-next-line react-hooks/immutability
  useFrame(({ clock }, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.55,
      delta,
    );
    const { sky, sun } = getWindowLight(animatedOpen.current * 100);
    animatedGlare.current = MathUtils.damp(
      animatedGlare.current,
      profile.glare,
      1.35,
      delta,
    );
    floorMaterial.uniforms.uColor.value.lerp(targetWarmth, 1 - Math.exp(-delta * 1.35));
    windowMaterial.uniforms.uColor.value.lerp(targetWarmth, 1 - Math.exp(-delta * 1.35));
    // eslint-disable-next-line react-hooks/immutability
    const cloudLight = getCloudTransmission(clock.elapsedTime);
    floorMaterial.uniforms.uOpacity.value = sun * animatedGlare.current * cloudLight * 0.2;
    // eslint-disable-next-line react-hooks/immutability
    windowMaterial.uniforms.uOpacity.value = sun * animatedGlare.current * cloudLight * 0.12;
    if (floorPatch.current) {
      floorPatch.current.scale.y = MathUtils.lerp(0.12, 1, sky);
      floorPatch.current.position.x = 5.15 + Math.sin(clock.elapsedTime * 0.14) * 0.075;
      floorPatch.current.position.z = -5.55 + Math.cos(clock.elapsedTime * 0.11) * 0.08;
    }
    if (windowGlow.current) {
      windowGlow.current.scale.x = MathUtils.lerp(0.1, 1, sky);
    }
  });

  useEffect(
    () => () => {
      floorMaterial.dispose();
      windowMaterial.dispose();
    },
    [floorMaterial, windowMaterial],
  );

  return (
    <group>
      <mesh
        ref={floorPatch}
        material={floorMaterial}
        position={[5.15, 1.018, -5.55]}
        rotation={[-Math.PI / 2, 0, -0.08]}
      >
        <planeGeometry args={[5.1, 1.55]} />
      </mesh>
      {tier === "premium" ? (
        <mesh
          ref={windowGlow}
          material={windowMaterial}
          position={[2.26, 2.18, -4.62]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[1.35, 1.35]} />
        </mesh>
      ) : null}
    </group>
  );
}

function createDustGeometry(tier: AssetTier) {
  const count = tier === "premium" ? 92 : 34;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  let seed = 1847;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    const along = random();
    const spread = 0.65 + along * 1.55;
    positions[index * 3] = -1.7 + along * 3.5;
    positions[index * 3 + 1] = (random() - 0.5) * 1.35;
    positions[index * 3 + 2] = (random() - 0.5) * spread * 2;
    phases[index] = random() * Math.PI * 2;
    sizes[index] = 2.2 + Math.pow(random(), 2) * (tier === "premium" ? 4.4 : 3.2);
    brightness[index] = 0.45 + random() * 0.55;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
  geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("aBrightness", new Float32BufferAttribute(brightness, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const dustVertexShader = `
  attribute float aPhase;
  attribute float aSize;
  attribute float aBrightness;
  uniform float uPixelRatio;
  uniform float uTime;
  varying float vShimmer;

  void main() {
    vec3 transformed = position;
    transformed.y += sin(uTime * 0.31 + aPhase) * 0.065;
    transformed.x += cos(uTime * 0.19 + aPhase * 1.7) * 0.045;
    transformed.z += sin(uTime * 0.23 + aPhase * 0.73) * 0.035;
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    float perspective = clamp(3.4 / max(-mvPosition.z, 0.35), 0.58, 1.7);
    gl_PointSize = aSize * uPixelRatio * perspective;
    gl_Position = projectionMatrix * mvPosition;
    vShimmer = aBrightness * (0.8 + sin(uTime * 0.67 + aPhase * 2.1) * 0.2);
  }
`;

const dustFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vShimmer;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float radius = length(point);
    if (radius > 0.5) discard;
    float softDisc = 1.0 - smoothstep(0.1, 0.5, radius);
    float core = exp(-radius * radius * 8.0);
    float alpha = softDisc * core * uOpacity * vShimmer;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function DustMotes({ curtain, mode, tier }: { curtain: number; mode: SceneMode; tier: AssetTier }) {
  const { gl } = useThree();
  const profile = modeProfile[mode];
  const geometry = useMemo(() => createDustGeometry(tier), [tier]);
  const points = useRef<ThreePoints>(null);
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const dustVisibility = mode === "morning" ? 0.72 : mode === "evening" ? 0.8 : mode === "cinema" ? 0.08 : 0;
  const animatedVisibility = useRef(dustVisibility);
  const targetWarmth = useMemo(() => new Color(profile.warmth), [profile.warmth]);
  const material = useMemo(
    () => new ShaderMaterial({
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fragmentShader: dustFragmentShader,
      toneMapped: false,
      transparent: true,
      uniforms: {
        uColor: { value: new Color("#ffd6a5") },
        uOpacity: { value: 0 },
        uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        uTime: { value: 0 },
      },
      vertexShader: dustVertexShader,
    }),
    [gl],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock }, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.25,
      delta,
    );
    const { sun } = getWindowLight(animatedOpen.current * 100);
    animatedVisibility.current = MathUtils.damp(
      animatedVisibility.current,
      dustVisibility,
      1.35,
      delta,
    );
    material.uniforms.uColor.value.lerp(targetWarmth, 1 - Math.exp(-delta * 1.35));
    material.uniforms.uOpacity.value =
      sun * animatedVisibility.current * getCloudTransmission(clock.elapsedTime) *
      (tier === "premium" ? 0.88 : 0.72);
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2);
    if (points.current) {
      points.current.position.y = 1.96 + Math.sin(clock.elapsedTime * 0.17) * 0.012;
      points.current.rotation.x = Math.sin(clock.elapsedTime * 0.11) * 0.006;
      points.current.rotation.y = Math.cos(clock.elapsedTime * 0.09) * 0.004;
    }
  });

  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      position={[4.25, 1.96, -5.55]}
    />
  );
}

function createStarGeometry(tier: AssetTier) {
  const count = tier === "premium" ? 120 : 52;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  let seed = 7919;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    const u = 0.025 + random() * 0.95;
    const minimumSky = getSkyline(u) + 0.04;
    const v = MathUtils.lerp(minimumSky, 0.985, random());
    positions[index * 3] = -7.955;
    positions[index * 3 + 1] = 1.72 + (v - 0.5) * 8.5;
    positions[index * 3 + 2] = -10.95 - (u - 0.5) * 22;
    phases[index] = random() * Math.PI * 2;
    sizes[index] = 1.65 + Math.pow(random(), 2) * 2.15;
    brightness[index] = 0.45 + random() * 0.55;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
  geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("aBrightness", new Float32BufferAttribute(brightness, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const starVertexShader = `
  attribute float aPhase;
  attribute float aSize;
  attribute float aBrightness;
  uniform float uPixelRatio;
  uniform float uTime;
  varying float vBrightness;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    vBrightness = aBrightness * (0.86 + 0.14 * sin(uTime * 0.83 + aPhase));
  }
`;

const starFragmentShader = `
  uniform float uOpacity;
  varying float vBrightness;

  void main() {
    float radius = length(gl_PointCoord - 0.5);
    if (radius > 0.5) discard;
    float glow = exp(-radius * radius * 17.0);
    float core = 1.0 - smoothstep(0.08, 0.28, radius);
    gl_FragColor = vec4(vec3(0.78, 0.87, 1.0), (glow * 0.55 + core * 0.45) * vBrightness * uOpacity);
  }
`;

function NightStars({ mode, tier }: { mode: SceneMode; tier: AssetTier }) {
  const { gl } = useThree();
  const geometry = useMemo(() => createStarGeometry(tier), [tier]);
  const material = useMemo(() => new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fragmentShader: starFragmentShader,
    toneMapped: false,
    transparent: true,
    uniforms: {
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(gl.getPixelRatio(), 1.5) },
      uTime: { value: 0 },
    },
    vertexShader: starVertexShader,
  }), [gl]);
  const visibility = useRef(mode === "night" ? 1 : mode === "cinema" ? 0.15 : 0);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ clock }, delta) => {
    const target = mode === "night" ? 1 : mode === "cinema" ? 0.15 : 0;
    visibility.current = MathUtils.damp(visibility.current, target, 1.2, delta);
    material.uniforms.uOpacity.value = visibility.current;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 1.5);
  });

  return <points geometry={geometry} material={material} />;
}

function Apartment({ mode, room, tier }: { mode: SceneMode; room: RoomView; tier: AssetTier }) {
  const { gl } = useThree();
  const profile = modeProfile[mode];
  const floorSuffix = tier === "premium" ? "2048" : "1024";
  const floorSource = useTexture(
    `/materials/smoked-oak-floor-${floorSuffix}.webp?rev=${SCENE_ASSET_REVISION}`,
  );
  const floorTexture = useMemo(
    () => {
      const next = floorSource.clone();
      next.wrapS = RepeatWrapping;
      next.wrapT = RepeatWrapping;
      next.anisotropy = tier === "premium" ? 8 : 2;
      next.colorSpace = SRGBColorSpace;
      next.needsUpdate = true;
      return next;
    },
    [floorSource, tier],
  );
  const materialGroups = useRef({
    all: [] as MeshStandardMaterial[],
    practical: [] as MeshStandardMaterial[],
  });
  const animatedMaterial = useRef({
    emissive: profile.emissive,
    environment: mode === "morning" ? 0.92 : 0.64,
    warmth: new Color(profile.warmth),
  });
  const targetWarmth = useMemo(() => new Color(profile.warmth), [profile.warmth]);
  const url =
    tier === "premium"
      ? `/models/AAELS-premium-web.glb?rev=${SCENE_ASSET_REVISION}`
      : room === "kitchen"
        ? `/models/AAELS-mobile-kitchen.glb?rev=${SCENE_ASSET_REVISION}`
        : `/models/AAELS-mobile-balanced.glb?rev=${SCENE_ASSET_REVISION}`;
  const gltf = useGLTF(url);
  const model = useMemo(() => gltf.scene.clone(true) as Group, [gltf.scene]);
  const floorGeometry = useMemo(() => {
    const surface = new BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const corners = [new Vector3(), new Vector3(), new Vector3()];
    const edgeA = new Vector3();
    const edgeB = new Vector3();
    model.updateMatrixWorld(true);

    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry;
      const position = geometry.getAttribute("position");
      if (!position) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const index = geometry.getIndex();
      const groups = geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];

      for (const group of groups) {
        if (!materials[group.materialIndex ?? 0]?.name.toLowerCase().includes("generic_wood_light")) {
          continue;
        }
        for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
          for (let corner = 0; corner < 3; corner += 1) {
            const vertexIndex = index ? index.getX(i + corner) : i + corner;
            corners[corner]
              .set(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex))
              .applyMatrix4(mesh.matrixWorld);
          }
          if (!corners.every((point) => Math.abs(point.y - 1.015) < 0.035)) continue;
          edgeA.subVectors(corners[1], corners[0]);
          edgeB.subVectors(corners[2], corners[0]);
          if (Math.abs(edgeA.cross(edgeB).y) < 0.5) continue;
          for (const point of corners) {
            positions.push(point.x, point.y + 0.004, point.z);
            uvs.push(point.x / 2.4, -point.z / 2.6);
          }
        }
      }
    });

    surface.setAttribute("position", new Float32BufferAttribute(positions, 3));
    surface.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    surface.computeVertexNormals();
    return surface;
  }, [model]);

  useEffect(() => {
    const anisotropy = Math.min(tier === "mobile" ? 2 : 8, gl.capabilities.getMaxAnisotropy());
    const allMaterials: MeshStandardMaterial[] = [];
    const practicalMaterials: MeshStandardMaterial[] = [];
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = tier === "premium";
      mesh.receiveShadow = tier === "premium";
      mesh.frustumCulled = true;

      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = source.map((material) => {
        // The mobile scene keeps the PBR maps but skips the costly physical
        // clearcoat/specular/sheen shader branches from the premium export.
        const next = tier === "mobile" && material.type === "MeshPhysicalMaterial"
          ? new MeshStandardMaterial().copy(material as MeshStandardMaterial)
          : material.clone() as MeshStandardMaterial;
        if (next.map) next.map.anisotropy = anisotropy;
        if (next.normalMap) next.normalMap.anisotropy = anisotropy;
        const name = next.name.toLowerCase();
        if (name.includes("glass")) {
          next.transparent = true;
          next.opacity = Math.min(next.opacity, 0.38);
          next.depthWrite = false;
          next.roughness = Math.min(next.roughness, 0.18);
          next.metalness = 0;
        }
        if (name.includes("mirror")) {
          next.metalness = 0.92;
          next.roughness = 0.12;
        }
        if (name.includes("ceiling_plaster")) {
          next.color.set("#d8c5ac");
          next.emissive = new Color("#17110e");
          next.emissiveIntensity = 0.025;
          next.roughness = 0.86;
        }
        allMaterials.push(next);
        if (practicalMaterialNames.has(next.name)) {
          practicalMaterials.push(next);
          next.toneMapped = false;
          next.needsUpdate = true;
        }
        return next;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
    materialGroups.current = { all: allMaterials, practical: practicalMaterials };
    return () => {
      materialGroups.current = { all: [], practical: [] };
    };
  }, [gl, model, tier]);

  useEffect(
    () => () => {
      floorGeometry.dispose();
      floorTexture.dispose();
    },
    [floorGeometry, floorTexture],
  );

  useFrame((_, delta) => {
    const targetEnvironment = mode === "morning" ? 0.92 : 0.64;
    animatedMaterial.current.environment = MathUtils.damp(
      animatedMaterial.current.environment,
      targetEnvironment,
      1.35,
      delta,
    );
    animatedMaterial.current.emissive = MathUtils.damp(
      animatedMaterial.current.emissive,
      profile.emissive,
      1.35,
      delta,
    );
    animatedMaterial.current.warmth.lerp(
      targetWarmth,
      1 - Math.exp(-delta * 1.35),
    );

    for (const material of materialGroups.current.all) {
      material.envMapIntensity = animatedMaterial.current.environment;
    }
    for (const material of materialGroups.current.practical) {
      material.emissive.copy(animatedMaterial.current.warmth);
      material.emissiveIntensity = 5.5 * animatedMaterial.current.emissive;
    }
  });

  return (
    <group>
      <primitive object={model} />
      <mesh geometry={floorGeometry} receiveShadow>
        <meshStandardMaterial
          map={floorTexture}
          color="#e8ded3"
          roughness={0.82}
          metalness={0}
          envMapIntensity={0.28}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
    </group>
  );
}

function CinematicCamera({
  mode,
  parallax,
  room,
  tier,
  viewAngles,
}: {
  mode: SceneMode;
  parallax: boolean;
  room: RoomView;
  tier: AssetTier;
  viewAngles: { current: { yaw: number; pitch: number } };
}) {
  const { camera, pointer, size } = useThree();
  const lookTarget = useRef(sceneShots[mode].target.clone());
  const desired = useMemo(() => new Vector3(), []);
  const desiredTarget = useMemo(() => new Vector3(), []);
  const offset = useMemo(() => new Vector3(), []);
  const direction = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);

  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    if (!perspective.isPerspectiveCamera) return;
    perspective.fov = tier === "mobile"
      ? (size.width < size.height ? 68 : 58)
      : WEB_CAMERA.verticalFov;
    perspective.updateProjectionMatrix();
  }, [camera, size.height, size.width, tier]);

  useLayoutEffect(() => {
    const shot = room === "kitchen" ? KITCHEN_CAMERA : sceneShots.evening;
    camera.position.copy(shot.position);
    lookTarget.current.copy(shot.target);
    camera.lookAt(lookTarget.current);
  }, [camera, room]);

  useFrame((_, delta) => {
    const shot = room === "kitchen" ? KITCHEN_CAMERA : sceneShots[mode];
    if (tier === "mobile") {
      const { yaw, pitch } = viewAngles.current;
      direction.subVectors(shot.target, shot.position);
      const distance = direction.length();
      direction.applyAxisAngle(up, yaw);
      direction.y += Math.tan(pitch) * distance;
      desired.copy(shot.position);
      desiredTarget.copy(shot.position).add(direction);
      const ease = 1 - Math.exp(-delta * 4.2);
      camera.position.lerp(desired, ease);
      lookTarget.current.lerp(desiredTarget, ease);
      camera.lookAt(lookTarget.current);
      return;
    }
    const horizontal = parallax ? pointer.x * 0.18 : 0;
    const vertical = parallax ? pointer.y * 0.08 : 0;
    offset.set(0, vertical, horizontal);
    desired.copy(shot.position).add(offset);
    desiredTarget.copy(shot.target).add(offset.multiplyScalar(0.3));
    const ease = 1 - Math.exp(-delta * 2.8);
    camera.position.lerp(desired, ease);
    lookTarget.current.lerp(desiredTarget, ease);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

function KitchenLightRig({ mode }: { mode: SceneMode }) {
  const profile = modeProfile[mode];
  const portal = useRef<RectAreaLight>(null);

  useLayoutEffect(() => {
    portal.current?.lookAt(5.25, 1.5, -17.1);
  }, []);

  return (
    <>
      <hemisphereLight args={["#d8e3ed", "#36251b", mode === "night" ? 0.22 : 0.52]} />
      <directionalLight
        color={mode === "evening" ? "#ffc38d" : mode === "night" ? "#9dbce4" : "#fff2df"}
        intensity={profile.key * (mode === "night" ? 0.2 : 0.75)}
        position={[0.5, 6.5, -24]}
      />
      <rectAreaLight
        ref={portal}
        color={mode === "evening" ? "#ffcf9a" : "#e5f0ff"}
        intensity={mode === "night" ? 0.4 : mode === "cinema" ? 0.75 : 1.8}
        width={3.4}
        height={2.5}
        position={[2.5, 1.75, -21.7]}
      />
      <pointLight
        color="#ffdebb"
        intensity={mode === "night" ? 1.2 : mode === "cinema" ? 0.4 : 0.45}
        distance={7}
        decay={2}
        position={[6.3, 2.4, -16.8]}
      />
    </>
  );
}

function KitchenCeiling() {
  const shape = useMemo(() => new Shape()
    .moveTo(2.1, 10.2)
    .lineTo(8.9, 10.2)
    .lineTo(8.9, 22.7)
    .lineTo(4.5, 22.7)
    .lineTo(2.1, 18.5)
    .closePath(), []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.91, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#b7a495" roughness={0.94} side={DoubleSide} />
    </mesh>
  );
}

function ExteriorLightRig({
  curtain,
  economy,
  mode,
  tier,
}: {
  curtain: number;
  economy: boolean;
  mode: SceneMode;
  tier: AssetTier;
}) {
  const profile = modeProfile[mode];
  const sunLight = useRef<DirectionalLight>(null);
  const skyLight = useRef<HemisphereLight>(null);
  const portalLight = useRef<RectAreaLight>(null);
  const practicalPoint = useRef<PointLight>(null);
  const bedsidePoint = useRef<PointLight>(null);
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const animatedProfile = useRef({ key: profile.key, practical: profile.practical });
  const initialLight = getWindowLight(curtain);
  const sunColor = useMemo(() => new Color({
    morning: "#fff0d2",
    evening: "#ffb56f",
    cinema: "#b27d6b",
    night: "#8ba9dc",
  }[mode]), [mode]);
  const skyColor = useMemo(() => new Color({
    morning: "#d8ebff",
    evening: "#c5b8ad",
    cinema: "#78839b",
    night: "#526a94",
  }[mode]), [mode]);
  const portalColor = useMemo(() => new Color(profile.warmth), [profile.warmth]);

  useLayoutEffect(() => {
    if (sunLight.current) {
      sunLight.current.target.position.set(6.8, 1.08, -6.15);
      sunLight.current.target.updateMatrixWorld();
    }
    portalLight.current?.lookAt(6.4, 1.45, -5.75);
  }, []);

  useFrame(({ clock }, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.7,
      delta,
    );
    const { sky, sun } = getWindowLight(animatedOpen.current * 100);
    const cloudLight = getCloudTransmission(clock.elapsedTime);
    animatedProfile.current.key = MathUtils.damp(
      animatedProfile.current.key,
      profile.key,
      1.35,
      delta,
    );
    animatedProfile.current.practical = MathUtils.damp(
      animatedProfile.current.practical,
      profile.practical,
      1.35,
      delta,
    );
    const atmosphereEase = 1 - Math.exp(-delta * 1.35);
    if (skyLight.current) {
      skyLight.current.intensity = 0.055 + sky * 0.13;
      skyLight.current.color.lerp(skyColor, atmosphereEase);
    }
    if (sunLight.current) {
      sunLight.current.intensity =
        animatedProfile.current.key * sun * cloudLight * (mode === "morning" ? 1.12 : 1.02);
      sunLight.current.color.lerp(sunColor, atmosphereEase);
      sunLight.current.position.lerp(sceneSunPositions[mode], atmosphereEase);
    }
    if (portalLight.current) {
      portalLight.current.intensity =
        animatedProfile.current.key * (0.04 + sky * 2.65 * cloudLight);
      portalLight.current.color.lerp(portalColor, atmosphereEase);
    }
    if (practicalPoint.current) {
      practicalPoint.current.intensity = 2.8 * animatedProfile.current.practical;
    }
    if (bedsidePoint.current) {
      bedsidePoint.current.intensity = MathUtils.damp(
        bedsidePoint.current.intensity,
        mode === "night" ? 1.6 : mode === "cinema" ? 0.18 : 0,
        1.4,
        delta,
      );
    }
  });

  return (
    <>
      <hemisphereLight
        ref={skyLight}
        args={["#b8c4d0", "#211611", 0.055 + initialLight.sky * 0.13]}
      />
      <directionalLight
        ref={sunLight}
        castShadow={tier === "premium"}
        color="#ffc180"
        intensity={
          profile.key * initialLight.sun * (mode === "morning" ? 1.12 : 1.02)
        }
        position={[-5.8, 7.8, -2.65]}
        shadow-bias={-0.00028}
        shadow-camera-bottom={-6}
        shadow-camera-far={28}
        shadow-camera-left={-8}
        shadow-camera-near={0.5}
        shadow-camera-right={8}
        shadow-camera-top={6}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <rectAreaLight
        ref={portalLight}
        color="#ffd6a4"
        height={2.3}
        intensity={profile.key * (0.04 + initialLight.sky * 2.65)}
        position={[2.08, 1.86, -5.55]}
        width={4.2}
      />
      {!economy ? (
        <AreaLight
          intensity={2.2 * profile.practical}
          position={[7.62, 2.86, -5.05]}
          temperature={3842}
          width={3.2}
        />
      ) : null}
      <pointLight
        ref={practicalPoint}
        color="#ffd4aa"
        decay={2}
        distance={4.5}
        intensity={2.8 * modeProfile.evening.practical}
        position={[7.9, 2.28, -8.35]}
      />
      <pointLight
        ref={bedsidePoint}
        color="#ffc594"
        decay={2}
        distance={3.1}
        intensity={mode === "night" ? 1.6 : 0}
        position={[6.72, 1.74, -6.66]}
      />
    </>
  );
}

function Scene({
  curtain,
  economy,
  mode,
  parallax,
  room,
  tier,
  viewAngles,
}: {
  curtain: number;
  economy: boolean;
  mode: SceneMode;
  parallax: boolean;
  room: RoomView;
  tier: AssetTier;
  viewAngles: { current: { yaw: number; pitch: number } };
}) {
  return (
    <>
      <SceneBackdrop mode={mode} />
      <SceneEnvironment curtain={room === "kitchen" ? 100 : curtain} mode={mode} />
      {room === "kitchen"
        ? <KitchenLightRig mode={mode} />
        : <ExteriorLightRig curtain={curtain} economy={economy} mode={mode} tier={tier} />}
      <ExteriorEnvironment curtain={room === "kitchen" ? 100 : curtain} mode={mode} room={room} tier={tier} />
      <Apartment mode={mode} room={room} tier={tier} />
      {room === "kitchen" ? <KitchenCeiling /> : null}
      {room === "bedroom" ? <>
        <CurtainSystem curtain={curtain} mode={mode} tier={tier} />
        <SunGlare curtain={curtain} mode={mode} tier={tier} />
        <DustMotes curtain={curtain} mode={mode} tier={tier} />
        <NightStars mode={mode} tier={tier} />
      </> : null}
      <CinematicCamera mode={mode} parallax={parallax} room={room} tier={tier} viewAngles={viewAngles} />
      {tier === "premium" ? <BloomPipeline mode={mode} /> : null}
    </>
  );
}

function MobileFrameClock({ onSample }: { onSample: (fps: number) => void }) {
  const invalidate = useThree((state) => state.invalidate);
  const frames = useRef(0);
  const sampledAt = useRef(0);

  useEffect(() => {
    let animationFrame = 0;
    let lastRequestedAt = 0;
    const tick = (now: number) => {
      // Leave a little room for rAF timestamp jitter on 60/90/120 Hz screens.
      if (now - lastRequestedAt >= 1000 / 32) {
        invalidate();
        lastRequestedAt = now;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [invalidate]);

  useFrame(() => {
    const now = performance.now();
    if (sampledAt.current === 0) sampledAt.current = now;
    frames.current += 1;
    const elapsed = now - sampledAt.current;
    if (elapsed > 5000) {
      frames.current = 0;
      sampledAt.current = now;
      return;
    }
    if (elapsed < 3000) return;
    onSample((frames.current * 1000) / elapsed);
    frames.current = 0;
    sampledAt.current = now;
  });

  return null;
}

function LoadStatus() {
  const { active, progress } = useProgress();
  if (!active && progress >= 100) return null;

  return (
    <div className="experience-loader" role="status" aria-live="polite">
      <span>Проявляем пространство</span>
      <strong>{Math.round(progress)}%</strong>
      <i>
        <b style={{ transform: `scaleX(${Math.max(0.02, progress / 100)})` }} />
      </i>
    </div>
  );
}

function CameraFlare({ curtain, mode }: { curtain: number; mode: SceneMode }) {
  const profile = cameraFlareProfile[mode];
  const { sun } = getWindowLight(curtain);
  const style = {
    left: `${profile.x}%`,
    opacity: profile.opacity * Math.pow(sun, 1.3),
    top: `${profile.y}%`,
  } satisfies CSSProperties;

  return (
    <div className={`camera-flare camera-flare-${mode}`} style={style} aria-hidden="true">
      <i className="camera-flare-core" />
      <i className="camera-flare-ghosts" />
      <i className="camera-flare-streak" />
    </div>
  );
}

function chooseTier(): AssetTier {
  const width = window.innerWidth;
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const processors = navigator.hardwareConcurrency;
  const constrainedHardware =
    width < 1180 &&
    ((memory !== undefined && memory <= 4) ||
      (processors !== undefined && processors <= 4));
  const compactTouchDevice = coarsePointer && width < 1100;
  return narrow || compactTouchDevice || constrainedHardware ? "mobile" : "premium";
}

export function HotelExperience() {
  const [mode, setMode] = useState<SceneMode>("evening");
  const [room, setRoom] = useState<RoomView>("bedroom");
  const [tier, setTier] = useState<AssetTier | null>(null);
  const [curtain, setCurtain] = useState(84);
  const [parallax, setParallax] = useState(true);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [hasExplored, setHasExplored] = useState(false);
  const [mobileCurtainOpen, setMobileCurtainOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessage, setAssistantMessage] = useState<AssistantMessage | null>(null);
  const [isViewing, setIsViewing] = useState(false);
  const [showPanHint, setShowPanHint] = useState(true);
  const [mobileDpr, setMobileDpr] = useState(1.3);
  const [economyMode, setEconomyMode] = useState(false);
  const mobileViewAngles = useRef({ yaw: -0.12, pitch: 0 });
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const demoTimers = useRef<number[]>([]);
  const assistantTimers = useRef<number[]>([]);
  const assistantSheetRef = useRef<HTMLElement | null>(null);
  const steadyWindows = useRef(0);
  const experienceState = useRef<ExperienceState>({ mode: "evening", curtain: 84, parallax: true });
  const stopDemo = () => {
    demoTimers.current.forEach((timer) => window.clearTimeout(timer));
    demoTimers.current = [];
    setDemoPlaying(false);
  };
  const stopAssistantSequence = () => {
    assistantTimers.current.forEach((timer) => window.clearTimeout(timer));
    assistantTimers.current = [];
  };
  const applyMode = (nextMode: SceneMode) => {
    setMode(nextMode);
    setCurtain(modeCurtainPresets[nextMode]);
  };
  const activateMode = (nextMode: SceneMode) => {
    stopDemo();
    stopAssistantSequence();
    applyMode(nextMode);
    setHasExplored(true);
  };
  const changeRoom = (nextRoom: RoomView) => {
    stopDemo();
    stopAssistantSequence();
    setRoom(nextRoom);
    setMobileCurtainOpen(false);
    mobileViewAngles.current = { yaw: 0, pitch: 0 };
    setHasExplored(true);
  };
  const toggleAssistantPanel = () => {
    setAssistantOpen((open) => !open);
    setMobileCurtainOpen(false);
    setHasExplored(true);
  };
  const runAssistantIntent = (intent: AssistantIntent, prompt: string) => {
    stopAssistantSequence();
    stopDemo();
    let response = "";
    switch (intent) {
      case "wake":
        changeRoom("bedroom");
        setMode("morning");
        setCurtain(15);
        assistantTimers.current = [
          window.setTimeout(() => setCurtain(48), 650),
          window.setTimeout(() => setCurtain(78), 1750),
        ];
        response = "Доброе утро. Открываю шторы постепенно и впускаю дневной свет.";
        break;
      case "view":
        changeRoom("kitchen");
        setMode("morning");
        response = "Показываю панораму из кухни-гостиной при дневном свете.";
        break;
      case "return":
        changeRoom("bedroom");
        setMode("evening");
        setCurtain(62);
        response = "С возвращением. Включаю тёплый вечерний свет и немного прикрываю шторы.";
        break;
      case "sleep":
        changeRoom("bedroom");
        setMode("night");
        setCurtain(0);
        response = "Готовлю номер ко сну: шторы закрыты, освещение переходит в ночной режим.";
        break;
      case "open":
        if (room === "kitchen") changeRoom("bedroom");
        setCurtain(100);
        response = room === "kitchen" ? "Возвращаюсь в номер и открываю шторы." : "Открываю шторы. Теперь видно долину.";
        break;
      case "close":
        if (room === "kitchen") changeRoom("bedroom");
        setCurtain(0);
        response = "Закрываю шторы. В номере становится спокойнее.";
        break;
      case "evening":
        applyMode("evening");
        response = "Включаю вечерний сценарий: тёплый свет и мягкая атмосфера.";
        break;
      case "cinema":
        if (room === "kitchen") changeRoom("bedroom");
        applyMode("cinema");
        response = "Включаю кино: свет приглушён, шторы закрыты.";
        break;
      case "night":
        applyMode("night");
        response = "Перехожу в ночной режим. Свет становится мягче.";
        break;
      case "morning":
        applyMode("morning");
        response = "Включаю утренний сценарий.";
        break;
    }
    setAssistantMessage({ prompt, response });
    setHasExplored(true);
  };
  const submitAssistantInput = () => {
    const prompt = assistantInput.trim();
    if (!prompt) return;
    const intent = parseAssistantIntent(prompt);
    if (intent) {
      runAssistantIntent(intent, prompt);
    } else {
      setAssistantMessage({
        prompt,
        response: "Пока я понимаю только запросы о пробуждении, виде, возвращении, сне, шторах и времени суток. Попробуйте один из примеров выше.",
      });
    }
    setAssistantInput("");
  };
  const adaptMobileResolution = useCallback((fps: number) => {
    if (fps < 24) {
      steadyWindows.current = 0;
      setEconomyMode(true);
      setMobileDpr((current) => Math.max(1.05, Math.round((current - 0.05) * 100) / 100));
      return;
    }
    if (fps < 29) {
      steadyWindows.current = 0;
      return;
    }
    steadyWindows.current += 1;
    if (steadyWindows.current < 3) return;
    steadyWindows.current = 0;
    setMobileDpr((current) => Math.min(1.4, Math.round((current + 0.03) * 100) / 100));
  }, []);
  const changeCurtain = (value: number) => {
    stopDemo();
    stopAssistantSequence();
    setCurtain(value);
    setHasExplored(true);
  };
  const toggleDemo = () => {
    setHasExplored(true);
    if (demoPlaying) {
      stopDemo();
      return;
    }
    stopDemo();
    stopAssistantSequence();
    setDemoPlaying(true);
    applyMode("morning");
    demoTimers.current = [
      window.setTimeout(() => applyMode("evening"), 6500),
      window.setTimeout(() => applyMode("night"), 13500),
      window.setTimeout(() => applyMode("evening"), 20500),
      window.setTimeout(() => {
        demoTimers.current = [];
        setDemoPlaying(false);
      }, 26000),
    ];
  };

  useEffect(() => () => {
    demoTimers.current.forEach((timer) => window.clearTimeout(timer));
    assistantTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (assistantOpen && assistantMessage) {
      assistantSheetRef.current?.scrollTo({ top: assistantSheetRef.current.scrollHeight });
    }
  }, [assistantMessage, assistantOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTier(chooseTier());
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setParallax(false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const beginMobilePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tier !== "mobile" || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMobilePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (tier !== "mobile" || !start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start.x = event.clientX;
    start.y = event.clientY;
    mobileViewAngles.current.yaw = MathUtils.clamp(
      mobileViewAngles.current.yaw + (dx / Math.max(window.innerWidth, 320)) * 0.68,
      room === "kitchen" ? -0.18 : -0.26,
      room === "kitchen" ? 0.18 : 0.16,
    );
    mobileViewAngles.current.pitch = MathUtils.clamp(
      mobileViewAngles.current.pitch + (dy / Math.max(window.innerHeight, 320)) * 0.45,
      -0.16,
      0.16,
    );
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      if (!hasExplored) setHasExplored(true);
      if (showPanHint) setShowPanHint(false);
    }
  };
  const endMobilePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    experienceState.current = { mode, curtain, parallax };
  }, [curtain, mode, parallax]);

  useEffect(() => {
    const context = (
      document as Document & { readonly modelContext?: WebMcpContext }
    ).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const waitForPaint = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const configureTool: WebMcpTool = {
      name: "configure_room_experience",
      title: "Настроить атмосферу номера",
      description:
        "Меняет видимый сценарий освещения, положение штор и живой параллакс 3D-камеры.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["morning", "evening", "cinema", "night"],
            description: "Сценарий атмосферы номера.",
          },
          curtain: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "Открытие штор в процентах.",
          },
          parallax: {
            type: "boolean",
            description: "Включить мягкое движение камеры за указателем.",
          },
        },
        minProperties: 1,
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error("Настройки должны быть переданы объектом.");
        }

        const next = input as Partial<ExperienceState>;
        const keys = Object.keys(next);
        if (keys.length === 0 || keys.some((key) => !["mode", "curtain", "parallax"].includes(key))) {
          throw new Error("Передайте хотя бы одну поддерживаемую настройку.");
        }
        if (next.mode !== undefined && !sceneModes.some((item) => item.id === next.mode)) {
          throw new Error("Неизвестный сценарий освещения.");
        }
        if (
          next.curtain !== undefined &&
          (!Number.isInteger(next.curtain) || next.curtain < 0 || next.curtain > 100)
        ) {
          throw new Error("Положение штор должно быть целым числом от 0 до 100.");
        }
        if (next.parallax !== undefined && typeof next.parallax !== "boolean") {
          throw new Error("Параллакс должен быть логическим значением.");
        }

        const configured = { ...experienceState.current, ...next } as ExperienceState;
        experienceState.current = configured;
        stopDemo();
        if (next.mode !== undefined) setMode(next.mode);
        if (next.curtain !== undefined) setCurtain(next.curtain);
        if (next.parallax !== undefined) setParallax(next.parallax);
        await waitForPaint();
        return { status: "configured", ...configured };
      },
    };

    const readTool: WebMcpTool = {
      name: "read_room_experience",
      title: "Прочитать атмосферу номера",
      description: "Возвращает текущий видимый сценарий, положение штор и состояние 3D-параллакса.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) {
          throw new Error("Для чтения состояния передайте пустой объект.");
        }
        return { ...experienceState.current };
      },
    };

    for (const tool of [configureTool, readTool]) {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch((error) => {
          console.warn(`WebMCP tool ${tool.name} could not be registered`, error);
        });
      } catch (error) {
        console.warn(`WebMCP tool ${tool.name} could not be registered`, error);
      }
    }

    return () => lifecycle.abort();
  }, []);

  return (
    <main className={`hotel-experience mode-${mode} room-${room}${hasExplored ? " has-explored" : ""}${isViewing ? " is-viewing" : ""}${assistantOpen ? " assistant-open" : ""}`} id="experience">
      <div
        className="scene-shell"
        aria-label="Интерактивное трёхмерное пространство номера"
        onPointerDownCapture={beginMobilePan}
        onPointerMoveCapture={moveMobilePan}
        onPointerUpCapture={endMobilePan}
        onPointerCancelCapture={endMobilePan}
      >
        {tier ? (
          <Canvas
            camera={{
              fov: WEB_CAMERA.verticalFov,
              near: 0.04,
              far: 60,
              position: WEB_CAMERA.position,
            }}
            dpr={tier === "mobile" ? mobileDpr : [1, 1.55]}
            frameloop={tier === "mobile" ? "demand" : "always"}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            performance={{ min: 0.55 }}
            shadows={tier === "premium"}
            onCreated={({ gl }) => {
              gl.outputColorSpace = SRGBColorSpace;
              gl.toneMapping = ACESFilmicToneMapping;
              gl.toneMappingExposure = modeProfile.evening.exposure;
            }}
          >
            <Suspense fallback={null}>
              <Scene
                curtain={curtain}
                economy={tier === "mobile" && economyMode}
                mode={mode}
                parallax={parallax}
                room={room}
                tier={tier}
                viewAngles={mobileViewAngles}
              />
              {tier === "mobile" ? <MobileFrameClock onSample={adaptMobileResolution} /> : null}
            </Suspense>
          </Canvas>
        ) : null}
      </div>

      <div className="cinematic-grade" aria-hidden="true" />
      {room === "bedroom" ? <CameraFlare curtain={curtain} mode={mode} /> : null}
      <LoadStatus />

      <header className="experience-header">
        <a className="brand" href="#experience" aria-label="Белкур — демонстрационный концепт">
          <span className="brand-symbol" aria-hidden="true">✦</span>
          <span className="brand-name">БЕЛКУР <small>концепт</small></span>
        </a>
        <div className="header-actions">
          <button type="button" className="room-switch-desktop" onClick={() => changeRoom(room === "bedroom" ? "kitchen" : "bedroom")}>
            <CookingPot aria-hidden="true" /> {room === "bedroom" ? "Кухня-гостиная" : "Вернуться в номер"}
          </button>
          <button type="button" className="demo-button" onClick={toggleDemo}>
            {demoPlaying ? "Остановить показ" : "Показать демо"} <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="hero-copy" aria-live="polite">
        <p className="hero-kicker">Интерактивный концепт · Белокуриха</p>
        <h1>
          Пространство
          <br />
          в вашем ритме
        </h1>
        <p className="hero-description">
          <span className="desktop-description">{room === "bedroom" ? "Откройте шторы, выберите время суток и почувствуйте, как меняется атмосфера номера." : "Загляните в кухню-гостиную: панорамный вид тоже становится частью пространства."}</span>
          <span className="mobile-description">{room === "bedroom" ? "Откройте шторы. Выберите время суток." : "Кухня-гостиная и вид на долину."}</span>
        </p>
      </section>

      {room === "bedroom" ? <aside className="room-panel glass-panel" id="technology" aria-label="Управление шторами">
        <div className="panel-title">
          <span>Управление</span>
          <small>3D-сцена</small>
        </div>

        <div className="curtain-card">
          <div className="curtain-heading">
            <span>Шторы</span>
            <strong>{curtain}%</strong>
          </div>
          <div className="curtain-preview" aria-hidden="true">
            <i style={{ width: `${(100 - curtain) / 2}%` }} />
            <b />
            <i style={{ width: `${(100 - curtain) / 2}%` }} />
          </div>
          <Slider
            aria-label="Положение штор"
            min={0}
            max={100}
            step={1}
            value={[curtain]}
            onValueChange={(value) => {
              changeCurtain(value[0] ?? 84);
            }}
          />
        </div>
        <p className="curtain-note">Положение штор меняет свет в номере.</p>
      </aside> : null}

      <aside className="assistant-panel glass-panel">
        <div className="assistant-heading">
          <span className="assistant-orb">
            <img src="/brand/alice-logo.svg" alt="" />
          </span>
          <span>
            <strong>Алиса · демо</strong>
            <small>Сценарии по запросу</small>
          </span>
        </div>
        <blockquote>
          {assistantMessage ? `«${assistantMessage.prompt}»` : "«Разбуди меня мягко»"}
        </blockquote>
        <button
          type="button"
          className="assistant-open-button"
          aria-label="Открыть команды Алисы — демонстрационный концепт"
          aria-expanded={assistantOpen}
          onClick={toggleAssistantPanel}
        >
          Задать запрос <ChevronRight aria-hidden="true" />
        </button>
        <small className="listening-label">Без подключения к устройствам</small>
      </aside>

      {assistantOpen ? <section ref={assistantSheetRef} className="assistant-demo-sheet glass-panel" aria-label="Демонстрация сценариев по запросу">
        <div className="assistant-demo-heading">
          <span className="assistant-orb"><img src="/brand/alice-logo.svg" alt="" /></span>
          <span><strong>Алиса · демо</strong><small>Запросы гостя</small></span>
          <button type="button" className="assistant-demo-close" aria-label="Закрыть панель запросов" onClick={toggleAssistantPanel}><X aria-hidden="true" /></button>
        </div>
        <p className="assistant-demo-intro">Один запрос меняет сразу несколько деталей номера. Попробуйте пример или напишите свой.</p>
        <div className="assistant-demo-commands">
          {assistantSuggestions.map((item) => <button
            key={item.intent}
            type="button"
            onClick={() => runAssistantIntent(item.intent, item.prompt)}
          >
            <span>«{item.prompt}»</span><ChevronRight aria-hidden="true" />
          </button>)}
        </div>
        <form className="assistant-demo-form" onSubmit={(event) => { event.preventDefault(); submitAssistantInput(); }}>
          <label htmlFor="assistant-request">Ваш запрос</label>
          <div>
            <input
              id="assistant-request"
              type="text"
              value={assistantInput}
              onChange={(event) => setAssistantInput(event.target.value)}
              placeholder="Например, закрой шторы"
              maxLength={100}
              autoComplete="off"
            />
            <button type="submit" aria-label="Отправить запрос" disabled={!assistantInput.trim()}><ArrowRight aria-hidden="true" /></button>
          </div>
        </form>
        {assistantMessage ? <div className="assistant-demo-conversation" aria-live="polite">
          <span>Ваш запрос</span><p>«{assistantMessage.prompt}»</p>
          <span>Что изменилось</span><p>{assistantMessage.response}</p>
        </div> : null}
        <small className="assistant-demo-disclaimer">
          Это интерактивный концепт, не подключённый к Алисе и реальным устройствам.
        </small>
      </section> : null}

      <aside className="scenario-panel glass-panel" id="scenarios">
        <div className="panel-title">
          <span>Время и атмосфера</span>
          <small>выберите сценарий</small>
        </div>
        <div className="scenario-list">
          {sceneModes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === mode ? "is-active" : ""}
              aria-pressed={item.id === mode}
              onClick={() => activateMode(item.id)}
            >
              <item.icon aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        </div>
      </aside>

      <div className="mobile-controls">
        {room === "bedroom" && mobileCurtainOpen && (
          <div className="mobile-curtain-panel glass-panel">
            <div className="curtain-heading">
              <span>Шторы</span>
              <strong>Открыты на {curtain}%</strong>
            </div>
            <Slider
              aria-label="Положение штор"
              min={0}
              max={100}
              step={1}
              value={[curtain]}
              onValueChange={(value) => changeCurtain(value[0] ?? 84)}
            />
          </div>
        )}
        <div className="mobile-actions glass-panel">
          {room === "bedroom" ? <button
            type="button"
            className="mobile-curtain-toggle"
            aria-expanded={mobileCurtainOpen}
            onClick={() => {
              setMobileCurtainOpen((open) => !open);
              setHasExplored(true);
            }}
          >
            <SlidersHorizontal aria-hidden="true" />
            <span>Шторы</span>
            <strong>{curtain}%</strong>
          </button> : null}
          <button
            type="button"
            className="mobile-alice-trigger"
            aria-label="Открыть демонстрацию сценариев по запросу"
            aria-expanded={assistantOpen}
            onClick={toggleAssistantPanel}
          >
            <img src="/brand/alice-logo.svg" alt="" />
            <span>Алиса · демо</span>
          </button>
        </div>
        <nav className="mobile-scenarios" aria-label="Сценарии освещения и обзор номера">
          {sceneModes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === mode ? "is-active" : ""}
              aria-label={item.label}
              aria-pressed={item.id === mode}
              onClick={() => activateMode(item.id)}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="mobile-room-trigger"
            aria-label={room === "bedroom" ? "Показать кухню-гостиную" : "Вернуться в номер"}
            onClick={() => changeRoom(room === "bedroom" ? "kitchen" : "bedroom")}
          >
            <CookingPot aria-hidden="true" />
            <span>{room === "bedroom" ? "Кухня" : "Номер"}</span>
          </button>
          <button
            type="button"
            className="mobile-look-trigger"
            aria-label="Осмотреть номер без панелей"
            onClick={() => {
              if (assistantOpen) {
                setAssistantOpen(false);
              }
              setIsViewing(true);
              setHasExplored(true);
            }}
          >
            <Maximize2 aria-hidden="true" />
            <span>Обзор</span>
          </button>
        </nav>
      </div>

      {isViewing ? (
        <>
          <button type="button" className="mobile-view-return glass-panel" onClick={() => setIsViewing(false)}>
            <Minimize2 aria-hidden="true" />
            Управление
          </button>
          {showPanHint ? <p className="mobile-pan-hint">Проведите пальцем по сцене, чтобы осмотреть номер</p> : null}
        </>
      ) : null}

      <footer className="experience-footer" id="about">
        <span>Демонстрационный концепт для Белкур</span>
        <button type="button" onClick={() => setParallax((value) => !value)}>
          {parallax ? "Живой ракурс включён" : "Камера зафиксирована"}
        </button>
        <span>Сцена не отражает точную планировку объекта</span>
      </footer>
    </main>
  );
}
