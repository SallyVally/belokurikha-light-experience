import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const auditPath = path.resolve(
  "C:/Users/Admin/Documents/AAELS/work/ue5_aaels_scene_audit.json",
);
const outputPath = path.resolve("public/data/ue5-aaels-scene.json");

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const root = audit.interesting_actors.find((actor) => actor.label === "root");

if (!root) {
  throw new Error("AAELS root actor was not found in the Unreal audit.");
}

const degrees = Math.PI / 180;
const rootYaw = root.rotation.yaw * degrees;
const rootCos = Math.cos(rootYaw);
const rootSin = Math.sin(rootYaw);

function toWebPosition(location) {
  const dx = (location.x - root.location.x) / 100;
  const dy = (location.y - root.location.y) / 100;
  const dz = (location.z - root.location.z) / 100;
  const localX = rootCos * dx + rootSin * dy;
  const localY = -rootSin * dx + rootCos * dy;
  return [round(-localY), round(dz), round(-localX)];
}

function toWebDirection(rotation) {
  const pitch = rotation.pitch * degrees;
  const yaw = rotation.yaw * degrees;
  const worldX = Math.cos(pitch) * Math.cos(yaw);
  const worldY = Math.cos(pitch) * Math.sin(yaw);
  const worldZ = Math.sin(pitch);
  const localX = rootCos * worldX + rootSin * worldY;
  const localY = -rootSin * worldX + rootCos * worldY;
  return normalize([-localY, worldZ, -localX]).map(round);
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function round(value) {
  return Number(value.toFixed(6));
}

function numberFromStruct(value, name) {
  const match = String(value).match(new RegExp(`${name}: ([\\d.-]+)`));
  return match ? Number(match[1]) : null;
}

const apartmentCamera = audit.interesting_actors
  .filter((actor) => actor.class_name === "CineCameraActor")
  .map((actor) => ({
    actor,
    distance: Math.hypot(
      actor.location.x - root.location.x,
      actor.location.y - root.location.y,
      actor.location.z - root.location.z,
    ),
  }))
  .sort((a, b) => a.distance - b.distance)[0]?.actor;

if (!apartmentCamera) {
  throw new Error("AAELS cine camera was not found in the Unreal audit.");
}

const cameraComponent = apartmentCamera.cameras[0];
const sensorHeight = numberFromStruct(cameraComponent.filmback, "sensor_height") ?? 25.46;
const focalLength = cameraComponent.current_focal_length ?? 28;
const verticalFov = (2 * Math.atan(sensorHeight / (2 * focalLength))) / degrees;
const ueActorPosition = toWebPosition(apartmentCamera.location);
const ueActorDirection = toWebDirection(apartmentCamera.rotation);

// The optimized GLB has Blender transforms baked into its room collections,
// so the UE actor basis cannot be applied directly. These anchors are measured
// in the final GLB and keep the camera clear of the corridor wall while aiming
// through the bedroom toward the window.
const cameraPosition = [7.35, 1.72, -3.75];
const cameraTarget = [2.55, 1.72, -6];
const cameraDirection = normalize(
  cameraTarget.map((value, index) => value - cameraPosition[index]),
).map(round);

const localLights = audit.interesting_actors
  .filter(
    (actor) =>
      actor.lights?.length &&
      Math.hypot(
        actor.location.x - root.location.x,
        actor.location.y - root.location.y,
        actor.location.z - root.location.z,
      ) < 5000,
  )
  .flatMap((actor) =>
    actor.lights.map((light) => ({
      label: actor.label,
      type: light.component_class.replace("LightComponent", "").toLowerCase(),
      position: toWebPosition(light.location ?? actor.location),
      direction: toWebDirection(light.rotation ?? actor.rotation),
      intensity: light.intensity,
      temperature: light.temperature,
      color: light.light_color,
      rangeMeters:
        typeof light.attenuation_radius === "number"
          ? round(light.attenuation_radius / 100)
          : null,
      widthMeters:
        typeof light.source_width === "number" ? round(light.source_width / 100) : null,
      heightMeters:
        typeof light.source_height === "number" ? round(light.source_height / 100) : null,
      innerCone: light.inner_cone_angle,
      outerCone: light.outer_cone_angle,
    })),
  );

const result = {
  source: {
    project: "CitySample",
    engine: "Unreal Engine 5.7.4",
    map: audit.map,
    generatedFrom: auditPath.replaceAll("\\", "/"),
  },
  apartment: {
    actor: root.label,
    componentCount: root.component_count,
    staticMeshComponentCount: root.component_classes.StaticMeshComponent,
    dimensionsMeters: [
      round((root.bounds_extent.x * 2) / 100),
      round((root.bounds_extent.z * 2) / 100),
      round((root.bounds_extent.y * 2) / 100),
    ],
  },
  camera: {
    label: apartmentCamera.label,
    position: cameraPosition,
    target: cameraTarget,
    direction: cameraDirection,
    focalLength,
    aperture: cameraComponent.current_aperture,
    horizontalFov: cameraComponent.field_of_view,
    verticalFov: round(verticalFov),
    postProcessBlendWeight: cameraComponent.post_process_blend_weight,
    postProcess: cameraComponent.post_process_settings,
    ueActorMapping: {
      position: ueActorPosition,
      direction: ueActorDirection,
    },
  },
  lighting: {
    count: localLights.length,
    rectCount: localLights.filter((light) => light.type === "rect").length,
    spotCount: localLights.filter((light) => light.type === "spot").length,
    lights: localLights,
  },
  webStrategy: {
    dynamicShadowLights: 1,
    realtimeAccentLights: 3,
    bakeRemainingLights: true,
    cameraMovement: "limited-parallax",
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
  `UE5 web recipe: ${result.lighting.count} lights, ${result.apartment.staticMeshComponentCount} meshes -> ${outputPath}`,
);
