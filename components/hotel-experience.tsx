"use client";

import { useGLTF, useProgress, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ArrowRight,
  ChevronRight,
  CloudSun,
  Home,
  LockKeyhole,
  Mic2,
  Moon,
  Music2,
  Search,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Thermometer,
  Video,
} from "lucide-react";
import {
  type CSSProperties,
  Suspense,
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
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PointLight,
  Points as ThreePoints,
  PointsMaterial,
  RectAreaLight,
  SRGBColorSpace,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
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

const SCENE_ASSET_REVISION = "2026-09-12-curtain-dynamics";
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

const sceneModes: Array<{
  id: SceneMode;
  label: string;
  note: string;
  icon: typeof SunMedium;
}> = [
  { id: "morning", label: "Утро", note: "Свет и климат", icon: SunMedium },
  { id: "evening", label: "Вечер", note: "Мягкая встреча", icon: Sparkles },
  { id: "cinema", label: "Кино", note: "Шторы и атмосфера", icon: Video },
  { id: "night", label: "Ночь", note: "Тихий маршрут", icon: Moon },
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
    environment: 0.12,
    exposure: 1.08,
    key: 0.1,
    practical: 0.22,
    emissive: 0.2,
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

function LandscapeRidge({
  mode,
  opacity,
  position,
  profile,
}: {
  mode: SceneMode;
  opacity: number;
  position: [number, number, number];
  profile: number[];
}) {
  const material = useRef<MeshBasicMaterial>(null);
  const animatedOpacity = useRef(opacity);
  const animatedColor = useRef(new Color(modeProfile[mode].ridgeTint));
  const targetColor = useMemo(() => new Color(modeProfile[mode].ridgeTint), [mode]);
  const geometry = useMemo(() => {
    const shape = new Shape();
    const halfWidth = 13;
    shape.moveTo(-halfWidth, -4);
    shape.lineTo(-halfWidth, profile[0]);
    profile.forEach((height, index) => {
      const x = -halfWidth + (index / (profile.length - 1)) * halfWidth * 2;
      shape.lineTo(x, height);
    });
    shape.lineTo(halfWidth, -4);
    shape.closePath();
    return new ShapeGeometry(shape);
  }, [profile]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const modeVisibility = mode === "morning" ? 0.62 : mode === "night" ? 0.82 : 1;
    animatedOpacity.current = MathUtils.damp(
      animatedOpacity.current,
      opacity * modeVisibility,
      1.3,
      delta,
    );
    animatedColor.current.lerp(targetColor, 1 - Math.exp(-delta * 1.3));
    if (material.current) {
      material.current.opacity = animatedOpacity.current;
      material.current.color.copy(animatedColor.current);
    }
  });

  return (
    <mesh geometry={geometry} position={position} rotation={[0, Math.PI / 2, 0]}>
      <meshBasicMaterial
        ref={material}
        color={animatedColor.current}
        depthWrite={false}
        opacity={opacity}
        toneMapped
        transparent
      />
    </mesh>
  );
}

const FAR_RIDGE = [-0.2, 0.02, 0.16, 0.08, 0.31, 0.2, 0.4, 0.24, 0.34, 0.12, 0.25];
const NEAR_RIDGE = [0.05, 0.28, 0.14, 0.46, 0.22, 0.54, 0.31, 0.42, 0.2, 0.38, 0.1];

const landscapeVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const landscapeFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uMorning;
  uniform sampler2D uEvening;
  uniform sampler2D uNight;
  uniform vec3 uWeights;
  uniform vec3 uTint;
  uniform float uBrightness;

  void main() {
    vec3 morning = texture2D(uMorning, vUv).rgb;
    vec3 evening = texture2D(uEvening, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;
    vec3 landscape = morning * uWeights.x + evening * uWeights.y + night * uWeights.z;
    gl_FragColor = vec4(landscape * uTint * uBrightness, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function ExteriorEnvironment({
  curtain,
  mode,
  tier,
}: {
  curtain: number;
  mode: SceneMode;
  tier: AssetTier;
}) {
  const profile = modeProfile[mode];
  const suffix = tier === "premium" ? "2048" : "1280";
  const texturePaths = useMemo(
    () => [
      `/environments/belokurikha-valley-morning-${suffix}.webp?rev=${SCENE_ASSET_REVISION}`,
      `/environments/belokurikha-valley-${suffix}.webp?rev=${SCENE_ASSET_REVISION}`,
      `/environments/belokurikha-valley-night-${suffix}.webp?rev=${SCENE_ASSET_REVISION}`,
    ],
    [suffix],
  );
  const textures = useTexture(texturePaths);
  const configuredTextures = useMemo(
    () => textures.map((texture) => {
      const next = texture.clone();
      next.colorSpace = SRGBColorSpace;
      next.anisotropy = tier === "premium" ? 8 : 2;
      next.needsUpdate = true;
      return next;
    }),
    [textures, tier],
  );
  const targetWeights = useMemo(
    () => new Vector3(...profile.landscapeMix),
    [profile.landscapeMix],
  );
  const targetTint = useMemo(() => new Color(profile.exteriorTint), [profile.exteriorTint]);
  const animatedWeights = useRef(targetWeights.clone());
  const animatedTint = useRef(targetTint.clone());
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const landscapeMaterial = useMemo(
    () => new ShaderMaterial({
      depthWrite: true,
      fragmentShader: landscapeFragmentShader,
      toneMapped: true,
      uniforms: {
        uBrightness: { value: 1 },
        uEvening: { value: configuredTextures[1] },
        uMorning: { value: configuredTextures[0] },
        uNight: { value: configuredTextures[2] },
        uTint: { value: animatedTint.current.clone() },
        uWeights: { value: animatedWeights.current.clone() },
      },
      vertexShader: landscapeVertexShader,
    }),
    [configuredTextures],
  );

  // The landscape material is intentionally animated by the render loop.
  useFrame((_, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.6,
      delta,
    );
    animatedWeights.current.lerp(targetWeights, 1 - Math.exp(-delta * 1.35));
    animatedTint.current.lerp(targetTint, 1 - Math.exp(-delta * 1.35));
    const brightness = 0.18 + Math.pow(animatedOpen.current, 0.72) * 0.82;
    landscapeMaterial.uniforms.uBrightness.value = brightness;
    landscapeMaterial.uniforms.uTint.value.copy(animatedTint.current);
    landscapeMaterial.uniforms.uWeights.value.copy(animatedWeights.current);
  });

  useEffect(
    () => () => {
      configuredTextures.forEach((texture) => texture.dispose());
      landscapeMaterial.dispose();
    },
    [configuredTextures, landscapeMaterial],
  );

  return (
    <group>
      <mesh
        material={landscapeMaterial}
        position={[-8, 1.72, -10.95]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[34, 12.75]} />
      </mesh>
      <LandscapeRidge
        mode={mode}
        opacity={0.2}
        position={[-2.6, 0.86, -10.4]}
        profile={FAR_RIDGE}
      />
      <LandscapeRidge
        mode={mode}
        opacity={0.3}
        position={[0.4, 0.72, -8.7]}
        profile={NEAR_RIDGE}
      />
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
    mesh.current.morphTargetInfluences[1] = Math.sin(motionTime) * state.waveEnergy * 0.82;
    mesh.current.morphTargetInfluences[2] = Math.cos(motionTime * 0.87) * state.waveEnergy * 0.58;
    mesh.current.rotation.x = Math.sin(motionTime * 0.72) * state.waveEnergy * 0.018;
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
  useFrame((_, delta) => {
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
    floorMaterial.uniforms.uOpacity.value = sun * animatedGlare.current * 0.2;
    // eslint-disable-next-line react-hooks/immutability
    windowMaterial.uniforms.uOpacity.value = sun * animatedGlare.current * 0.12;
    if (floorPatch.current) {
      floorPatch.current.scale.y = MathUtils.lerp(0.12, 1, sky);
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
  const count = tier === "premium" ? 78 : 24;
  const positions = new Float32Array(count * 3);
  let seed = 1847;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    const along = random();
    const spread = 0.2 + along * 0.52;
    positions[index * 3] = -1.7 + along * 3.5;
    positions[index * 3 + 1] = (random() - 0.5) * 1.35;
    positions[index * 3 + 2] = (random() - 0.5) * spread * 2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function DustMotes({ curtain, mode, tier }: { curtain: number; mode: SceneMode; tier: AssetTier }) {
  const profile = modeProfile[mode];
  const geometry = useMemo(() => createDustGeometry(tier), [tier]);
  const points = useRef<ThreePoints>(null);
  const material = useRef<PointsMaterial>(null);
  const animatedOpen = useRef(getWindowLight(curtain).open);
  const animatedGlare = useRef(profile.glare);
  const targetWarmth = useMemo(() => new Color(profile.warmth), [profile.warmth]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.25,
      delta,
    );
    const { sun } = getWindowLight(animatedOpen.current * 100);
    animatedGlare.current = MathUtils.damp(
      animatedGlare.current,
      profile.glare,
      1.35,
      delta,
    );
    if (material.current) {
      material.current.color.lerp(targetWarmth, 1 - Math.exp(-delta * 1.35));
      material.current.opacity =
        sun * animatedGlare.current * (tier === "premium" ? 0.38 : 0.2);
    }
    if (points.current) {
      points.current.position.y = 1.96 + Math.sin(clock.elapsedTime * 0.48) * 0.025;
      points.current.rotation.x = Math.sin(clock.elapsedTime * 0.21) * 0.012;
      points.current.rotation.y = Math.cos(clock.elapsedTime * 0.17) * 0.009;
    }
  });

  return (
    <points ref={points} geometry={geometry} position={[4.25, 1.96, -5.55]}>
      <pointsMaterial
        ref={material}
        blending={AdditiveBlending}
        color={profile.warmth}
        depthWrite={false}
        opacity={0}
        size={tier === "premium" ? 0.022 : 0.027}
        sizeAttenuation
        toneMapped={false}
        transparent
      />
    </points>
  );
}

function createStarGeometry(tier: AssetTier) {
  const count = tier === "premium" ? 64 : 28;
  const positions = new Float32Array(count * 3);
  let seed = 7919;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = -7.45 + random() * 0.12;
    positions[index * 3 + 1] = 2.55 + random() * 3.2;
    positions[index * 3 + 2] = -2.8 - random() * 6.2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function NightStars({ mode, tier }: { mode: SceneMode; tier: AssetTier }) {
  const geometry = useMemo(() => createStarGeometry(tier), [tier]);
  const material = useRef<PointsMaterial>(null);
  const visibility = useRef(mode === "night" ? 1 : mode === "cinema" ? 0.35 : 0);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }, delta) => {
    const target = mode === "night" ? 1 : mode === "cinema" ? 0.35 : 0;
    visibility.current = MathUtils.damp(visibility.current, target, 1.2, delta);
    if (material.current) {
      const twinkle = 0.72 + Math.sin(clock.elapsedTime * 1.7) * 0.06;
      material.current.opacity = visibility.current * twinkle;
    }
  });

  return (
    <points geometry={geometry}>
      <pointsMaterial
        ref={material}
        blending={AdditiveBlending}
        color="#dceaff"
        depthWrite={false}
        opacity={0}
        size={tier === "premium" ? 0.032 : 0.042}
        sizeAttenuation
        toneMapped={false}
        transparent
      />
    </points>
  );
}

function Apartment({ mode, tier }: { mode: SceneMode; tier: AssetTier }) {
  const { gl } = useThree();
  const profile = modeProfile[mode];
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
      : `/models/AAELS-mobile.glb?rev=${SCENE_ASSET_REVISION}`;
  const gltf = useGLTF(url);
  const model = useMemo(() => gltf.scene.clone(true) as Group, [gltf.scene]);

  useEffect(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
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
        const next = material.clone() as MeshStandardMaterial;
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

  return <primitive object={model} />;
}

function CinematicCamera({ mode, parallax }: { mode: SceneMode; parallax: boolean }) {
  const { camera, pointer } = useThree();
  const lookTarget = useRef(sceneShots[mode].target.clone());
  const desired = useMemo(() => new Vector3(), []);
  const desiredTarget = useMemo(() => new Vector3(), []);
  const offset = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    camera.position.copy(sceneShots.evening.position);
    lookTarget.current.copy(sceneShots.evening.target);
    camera.lookAt(lookTarget.current);
  }, [camera]);

  useFrame((_, delta) => {
    const shot = sceneShots[mode];
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

function ExteriorLightRig({
  curtain,
  mode,
  tier,
}: {
  curtain: number;
  mode: SceneMode;
  tier: AssetTier;
}) {
  const profile = modeProfile[mode];
  const sunLight = useRef<DirectionalLight>(null);
  const skyLight = useRef<HemisphereLight>(null);
  const portalLight = useRef<RectAreaLight>(null);
  const practicalPoint = useRef<PointLight>(null);
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

  useFrame((_, delta) => {
    animatedOpen.current = MathUtils.damp(
      animatedOpen.current,
      getWindowLight(curtain).open,
      3.7,
      delta,
    );
    const { sky, sun } = getWindowLight(animatedOpen.current * 100);
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
        animatedProfile.current.key * sun * (mode === "morning" ? 1.12 : 1.02);
      sunLight.current.color.lerp(sunColor, atmosphereEase);
      sunLight.current.position.lerp(sceneSunPositions[mode], atmosphereEase);
    }
    if (portalLight.current) {
      portalLight.current.intensity = animatedProfile.current.key * (0.04 + sky * 2.65);
      portalLight.current.color.lerp(portalColor, atmosphereEase);
    }
    if (practicalPoint.current) {
      practicalPoint.current.intensity = 2.8 * animatedProfile.current.practical;
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
      <AreaLight
        intensity={2.2 * profile.practical}
        position={[7.62, 2.86, -5.05]}
        temperature={3842}
        width={3.2}
      />
      <pointLight
        ref={practicalPoint}
        color="#ffd4aa"
        decay={2}
        distance={4.5}
        intensity={2.8 * modeProfile.evening.practical}
        position={[7.9, 2.28, -8.35]}
      />
    </>
  );
}

function Scene({
  curtain,
  mode,
  parallax,
  tier,
}: {
  curtain: number;
  mode: SceneMode;
  parallax: boolean;
  tier: AssetTier;
}) {
  return (
    <>
      <SceneBackdrop mode={mode} />
      <SceneEnvironment curtain={curtain} mode={mode} />
      <ExteriorLightRig curtain={curtain} mode={mode} tier={tier} />
      <ExteriorEnvironment curtain={curtain} mode={mode} tier={tier} />
      <Apartment mode={mode} tier={tier} />
      <CurtainSystem curtain={curtain} mode={mode} tier={tier} />
      <SunGlare curtain={curtain} mode={mode} tier={tier} />
      <DustMotes curtain={curtain} mode={mode} tier={tier} />
      <NightStars mode={mode} tier={tier} />
      <CinematicCamera mode={mode} parallax={parallax} />
      {tier === "premium" ? <BloomPipeline mode={mode} /> : null}
    </>
  );
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

const roomStatus = [
  { icon: Home, label: "Статус номера", value: "Комфортный режим" },
  { icon: Thermometer, label: "Климат", value: "22° · воздух в норме" },
  { icon: ShieldCheck, label: "Безопасность", value: "Контур активен" },
  { icon: Music2, label: "Музыка", value: "Belokurikha calm" },
  { icon: LockKeyhole, label: "Замки", value: "Закрыто" },
];

export function HotelExperience() {
  const [mode, setMode] = useState<SceneMode>("evening");
  const [tier, setTier] = useState<AssetTier | null>(null);
  const [curtain, setCurtain] = useState(84);
  const [listening, setListening] = useState(false);
  const [parallax, setParallax] = useState(true);
  const experienceState = useRef<ExperienceState>({ mode: "evening", curtain: 84, parallax: true });
  const activeMode = sceneModes.find((item) => item.id === mode) ?? sceneModes[1];
  const activateMode = (nextMode: SceneMode) => {
    setMode(nextMode);
    setCurtain(modeCurtainPresets[nextMode]);
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTier(chooseTier());
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setParallax(false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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
    <main className={`hotel-experience mode-${mode}`} id="experience">
      <div className="scene-shell" aria-label="Интерактивное трёхмерное пространство номера">
        {tier ? (
          <Canvas
            camera={{
              fov: WEB_CAMERA.verticalFov,
              near: 0.04,
              far: 60,
              position: WEB_CAMERA.position,
            }}
            dpr={tier === "mobile" ? [0.72, 1.05] : [1, 1.55]}
            gl={{ antialias: tier === "premium", powerPreference: "high-performance" }}
            performance={{ min: 0.55 }}
            shadows={tier === "premium"}
            onCreated={({ gl }) => {
              gl.outputColorSpace = SRGBColorSpace;
              gl.toneMapping = ACESFilmicToneMapping;
              gl.toneMappingExposure = modeProfile.evening.exposure;
            }}
          >
            <Suspense fallback={null}>
              <Scene curtain={curtain} mode={mode} parallax={parallax} tier={tier} />
            </Suspense>
          </Canvas>
        ) : null}
      </div>

      <div className="cinematic-grade" aria-hidden="true" />
      <CameraFlare curtain={curtain} mode={mode} />
      <LoadStatus />

      <header className="experience-header">
        <a className="brand" href="#experience" aria-label="AAELS — на главную">
          <span className="brand-symbol">A</span>
          <span>AAELS</span>
        </a>
        <nav className="main-nav" aria-label="Основная навигация">
          <a href="#experience">Пространство</a>
          <a href="#scenarios">Сценарии</a>
          <a href="#technology">Технологии</a>
          <a href="#about">О проекте</a>
        </nav>
        <div className="header-actions">
          <button type="button" className="icon-button" aria-label="Поиск">
            <Search aria-hidden="true" />
          </button>
          <button type="button" className="demo-button" onClick={() => activateMode("evening")}>
            Запустить демо <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="hero-copy" aria-live="polite">
        <p className="hero-kicker">Интеллектуальная среда · Белокуриха</p>
        <h1>
          Номер, который
          <br />
          чувствует гостя
        </h1>
        <p className="hero-description">
          Свет, климат и приватность меняются вместе с вашим ритмом. Пространство
          остаётся живым — прямо в браузере.
        </p>
      </section>

      <div className="weather" aria-label="Белокуриха, Алтай, плюс 18 градусов">
        <CloudSun aria-hidden="true" />
        <span>
          <small>Белокуриха, Алтай</small>
          <strong>+18°</strong>
        </span>
      </div>

      <aside className="room-panel glass-panel" id="technology" aria-label="Состояние номера">
        <div className="panel-title">
          <span>Среда номера</span>
          <small>все системы онлайн</small>
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
            onValueChange={(value) => setCurtain(value[0] ?? 84)}
          />
        </div>

        <ul className="status-list">
          {roomStatus.map((item) => (
            <li key={item.label}>
              <item.icon aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.value}</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </li>
          ))}
        </ul>
      </aside>

      <aside className={`assistant-panel glass-panel ${listening ? "is-listening" : ""}`}>
        <div className="assistant-heading">
          <span className="assistant-orb">
            <Sparkles aria-hidden="true" />
          </span>
          <span>
            <strong>AI-консьерж</strong>
            <small>Голосовое управление номером</small>
          </span>
        </div>
        <blockquote>
          {listening ? "Слушаю вас…" : `«Включи сценарий “${activeMode.label}”»`}
        </blockquote>
        <div className="voice-wave" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => (
            <i key={index} style={{ animationDelay: `${index * -55}ms` }} />
          ))}
        </div>
        <button
          type="button"
          className="voice-button"
          aria-label={listening ? "Остановить прослушивание" : "Активировать голосовое управление"}
          aria-pressed={listening}
          onClick={() => setListening((value) => !value)}
        >
          <Mic2 aria-hidden="true" />
        </button>
        <small className="listening-label">{listening ? "Слушаю…" : "Нажмите, чтобы говорить"}</small>
      </aside>

      <aside className="scenario-panel glass-panel" id="scenarios">
        <div className="panel-title">
          <span>Быстрые сценарии</span>
          <small>{tier === "premium" ? "cinematic render" : "adaptive render"}</small>
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

      <div className="mobile-status glass-panel">
        <span>
          <Thermometer aria-hidden="true" /> 22°
        </span>
        <span>Шторы {curtain}%</span>
        <button type="button" onClick={() => setParallax((value) => !value)}>
          {parallax ? "Живой ракурс" : "Ракурс зафиксирован"}
        </button>
      </div>

      <nav className="mobile-scenarios" aria-label="Сценарии освещения">
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
      </nav>

      <footer className="experience-footer" id="about">
        <span>AAELS · immersive hospitality</span>
        <button type="button" onClick={() => setParallax((value) => !value)}>
          {parallax ? "Живой ракурс включён" : "Камера зафиксирована"}
        </button>
        <span>UE5 look · WebGL experience</span>
      </footer>
    </main>
  );
}
