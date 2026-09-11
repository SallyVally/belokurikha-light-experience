"use client";

import { useGLTF, useProgress } from "@react-three/drei";
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
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  RectAreaLight,
  SRGBColorSpace,
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

const UE_CAMERA = {
  position: [5.329332, 1.838943, -7.790785] as [number, number, number],
  target: [11.324226, 1.942773, -8.015371] as [number, number, number],
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
    warmth: string;
  }
> = {
  morning: {
    background: "#777c7b",
    environment: 0.92,
    exposure: 1.18,
    key: 2.8,
    practical: 0.2,
    emissive: 0.05,
    bloom: 0.34,
    warmth: "#fff1db",
  },
  evening: {
    background: "#4a2b1d",
    environment: 0.48,
    exposure: 1.34,
    key: 1.05,
    practical: 1,
    emissive: 0.72,
    bloom: 0.76,
    warmth: "#ffd6a4",
  },
  cinema: {
    background: "#120d0c",
    environment: 0.25,
    exposure: 1.18,
    key: 0.28,
    practical: 0.52,
    emissive: 0.42,
    bloom: 0.92,
    warmth: "#dba47a",
  },
  night: {
    background: "#070808",
    environment: 0.12,
    exposure: 1.08,
    key: 0.1,
    practical: 0.22,
    emissive: 0.2,
    bloom: 0.58,
    warmth: "#d98c56",
  },
};

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
    position: new Vector3(5.2, 1.9, -7.62),
    target: new Vector3(11.36, 1.98, -8.08),
  },
  evening: {
    position: new Vector3(...UE_CAMERA.position),
    target: new Vector3(...UE_CAMERA.target),
  },
  cinema: {
    position: new Vector3(5.42, 1.78, -7.68),
    target: new Vector3(11.22, 1.86, -8.18),
  },
  night: {
    position: new Vector3(5.16, 1.82, -7.93),
    target: new Vector3(11.05, 1.88, -8.02),
  },
};

function kelvinToColor(kelvin: number) {
  if (kelvin >= 5000) return "#fff4df";
  return "#ffd2a0";
}

function AreaLight({
  intensity,
  position,
  temperature,
  width,
}: {
  intensity: number;
  position: [number, number, number];
  temperature: number;
  width: number;
}) {
  const light = useRef<RectAreaLight>(null);

  useLayoutEffect(() => {
    light.current?.lookAt(position[0], position[1] - 1, position[2]);
  }, [position]);

  return (
    <rectAreaLight
      ref={light}
      color={kelvinToColor(temperature)}
      intensity={intensity}
      position={position}
      width={width}
      height={0.08}
    />
  );
}

function SceneEnvironment({ curtain, mode }: { curtain: number; mode: SceneMode }) {
  const { gl, scene } = useThree();
  const profile = modeProfile[mode];

  useEffect(() => {
    RectAreaLightUniformsLib.init();
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04).texture;
    scene.environment = environment;
    return () => {
      scene.environment = null;
      environment.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  useEffect(() => {
    const daylight = 0.36 + curtain / 156;
    scene.environmentIntensity = profile.environment * daylight;
    gl.toneMappingExposure = profile.exposure;
  }, [curtain, gl, profile, scene]);

  return null;
}

function BloomPipeline({ mode }: { mode: SceneMode }) {
  const { camera, gl, scene, size } = useThree();
  const profile = modeProfile[mode];
  const composer = useMemo(() => new EffectComposer(gl), [gl]);
  const bloom = useMemo(
    () => new UnrealBloomPass(new Vector2(1, 1), profile.bloom, 0.72, 0.78),
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

  useEffect(() => {
    bloom.strength = profile.bloom;
    bloom.radius = mode === "night" ? 0.82 : 0.68;
    bloom.threshold = mode === "morning" ? 0.88 : 0.72;
  }, [bloom, mode, profile]);

  useFrame(() => composer.render(), 1);
  return null;
}

function Apartment({ mode, tier }: { mode: SceneMode; tier: AssetTier }) {
  const { gl } = useThree();
  const profile = modeProfile[mode];
  const url =
    tier === "premium" ? "/models/AAELS-premium-web.glb" : "/models/AAELS-mobile.glb";
  const gltf = useGLTF(url);
  const model = useMemo(() => gltf.scene.clone(true) as Group, [gltf.scene]);

  useEffect(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
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
        return next;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
  }, [gl, model]);

  useEffect(() => {
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial) continue;
        standard.envMapIntensity = mode === "morning" ? 0.92 : 0.64;
        if (!practicalMaterialNames.has(standard.name)) continue;
        standard.emissive = new Color(profile.warmth);
        standard.emissiveIntensity = 5.5 * profile.emissive;
        standard.toneMapped = false;
        standard.needsUpdate = true;
      }
    });
  }, [mode, model, profile]);

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
  const profile = modeProfile[mode];
  const daylight = 0.38 + curtain / 160;

  return (
    <>
      <color attach="background" args={[profile.background]} />
      <SceneEnvironment curtain={curtain} mode={mode} />
      <hemisphereLight
        args={[mode === "morning" ? "#eaf4ff" : "#b9c4ce", "#22150f", 0.5 * daylight]}
      />
      <directionalLight
        color={mode === "morning" ? "#fff0d7" : "#ffc58f"}
        intensity={profile.key * daylight}
        position={[9.2, 7.4, -4.5]}
      />
      <AreaLight
        intensity={12 * profile.practical}
        position={[11.685, 2.88, -8.972]}
        temperature={3842}
        width={7.84}
      />
      <AreaLight
        intensity={9 * profile.practical}
        position={[7.623, 2.863, -5.055]}
        temperature={3842}
        width={5.2}
      />
      <AreaLight
        intensity={7 * profile.practical}
        position={[12.8, 2.882, -11.165]}
        temperature={3842}
        width={4.16}
      />
      <pointLight
        color="#fff0d7"
        decay={2}
        distance={10}
        intensity={18 * profile.practical}
        position={[16.73, 1.95, -7.42]}
      />
      <Apartment mode={mode} tier={tier} />
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

function chooseTier(): AssetTier {
  const compact = window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return compact || (memory !== undefined && memory <= 6) ? "mobile" : "premium";
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

  useEffect(() => {
    setTier(chooseTier());
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setParallax(false);
    }
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
              fov: UE_CAMERA.verticalFov,
              near: 0.04,
              far: 60,
              position: UE_CAMERA.position,
            }}
            dpr={tier === "mobile" ? [0.72, 1.05] : [1, 1.55]}
            gl={{ antialias: tier === "premium", powerPreference: "high-performance" }}
            performance={{ min: 0.55 }}
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
          <button type="button" className="demo-button" onClick={() => setMode("evening")}>
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
              onClick={() => setMode(item.id)}
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
            onClick={() => setMode(item.id)}
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
