import React, { useEffect, useState, Suspense, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, extend } from "@react-three/fiber";
import { OrbitControls, useFBX, useTexture, Text } from "@react-three/drei";
import { EffectComposer, RenderPass, ShaderPass } from "three-stdlib";
import { useControls, Leva, button } from "leva";

extend({ EffectComposer, RenderPass, ShaderPass });

/**
 * Utility to normalize ramp input from Leva so useTexture never crashes
 */
function useSafeTexture(rampFile) {
  let path = "/ramp1.png"; // fallback default
  if (typeof rampFile === "string") {
    path = rampFile;
  } else if (rampFile && typeof rampFile === "object" && "src" in rampFile) {
    path = rampFile.src;
  }
  return useTexture(path);
}

// ------------------ PRISM ------------------
function Prism({ rampFile }) {
  const fbx = useFBX("/prism.fbx");
  const rampTex = useSafeTexture(rampFile);

  const { ambient } = useControls("Prism Shader", {
    ambient: { value: 0.2, min: 0.0, max: 1.0, step: 0.01 },
  });

  useFrame(() => {
    if (fbx) fbx.rotation.y += 0.01;
  });

  useEffect(() => {
    if (!fbx) return;

    // Normalize size
    const box = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetSize = 20;
    const maxDim = Math.max(size.x, size.z);
    const scaleFactor = targetSize / maxDim;
    fbx.scale.setScalar(scaleFactor);

    // Apply shader
    fbx.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.material = new THREE.ShaderMaterial({
          uniforms: {
            rampTex: { value: rampTex },
            lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
            uAmbient: { value: ambient },
          },
          vertexShader: `
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D rampTex;
            uniform vec3 lightDir;
            uniform float uAmbient;
            varying vec3 vNormal;
            void main() {
              float diff = max(dot(normalize(vNormal), normalize(lightDir)), 0.0);
              diff = clamp(diff + uAmbient, 0.0, 1.0); // ✅ fixed ambient
              vec2 uv = vec2(diff, 0.5);
              vec3 rampColor = texture2D(rampTex, uv).rgb;
              gl_FragColor = vec4(rampColor, 1.0);
            }
          `,
        });
      }
    });
  }, [fbx, rampTex, ambient]);

  return fbx ? <primitive object={fbx} /> : null;
}

// ------------------ BACKGROUND ------------------
function BackgroundEnclosure({ rampFile }) {
  const rampTex = useSafeTexture(rampFile);
  const geometry = new THREE.BoxGeometry(500, 500, 500);

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { rampTex: { value: rampTex } },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D rampTex;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y * 0.5 + 0.5;
        vec2 uv = vec2(h, 0.5);
        vec3 rampColor = texture2D(rampTex, uv).rgb;
        gl_FragColor = vec4(rampColor, 1.0);
      }
    `,
    depthWrite: false,
  });

  return <mesh geometry={geometry} material={material} />;
}

// ------------------ ORBITING TEXT ------------------
function OrbitingText() {
  const group = useRef();

  const { orbitText, orbitTilt, orbitRadius, speed } = useControls("Orbiting Text", {
    orbitText: { value: "PRISM COLLECTIVE", label: "Text" },
    orbitTilt: { value: 0, min: -90, max: 90, step: 1 },
    orbitRadius: { value: 25, min: 10, max: 100, step: 1 },
    speed: { value: 0.01, min: -0.05, max: 0.05, step: 0.001 },
  });

  useFrame(() => {
    if (group.current) group.current.rotation.y += speed;
  });

  const repeatedPhrase = (orbitText + "   ").repeat(20);
  const chars = Array.from(repeatedPhrase);
  const N = chars.length;

  return (
    <group ref={group} rotation={[THREE.MathUtils.degToRad(orbitTilt), 0, 0]}>
      {chars.map((ch, i) => {
        const angle = (i / N) * Math.PI * 2;
        const x = Math.cos(angle) * orbitRadius;
        const z = Math.sin(angle) * orbitRadius;

        return (
          <Text
            key={i}
            position={[x, 0, z]}
            font="/AzeretMono-Light.ttf"
            fontSize={1.5}
            color="white"
            anchorX="center"
            anchorY="middle"
            rotation={[0, angle + Math.PI, 0]} // readable from outside
          >
            {ch}
          </Text>
        );
      })}
    </group>
  );
}

// ------------------ CAMERA ------------------
function CameraFromTD({ data }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (!data) return;
    const toRad = THREE.MathUtils.degToRad;
    camera.position.set(data.position[0], data.position[1], data.position[2]);
    camera.rotation.set(
      toRad(data.rotation_deg[0]),
      toRad(data.rotation_deg[1]),
      toRad(data.rotation_deg[2])
    );
    camera.fov = data.fov || 45;
    camera.near = data.near || 0.1;
    camera.far = data.far || 2000;
    camera.updateProjectionMatrix();
  }, [data, camera]);
  return null;
}

// ------------------ LIGHT ------------------
function LightFromTD({ data }) {
  const lightRef = useRef();
  const { scene } = useThree();

  useEffect(() => {
    if (!data || !lightRef.current) return;

    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    scene.add(target);
    lightRef.current.target = target;

    const origPos = new THREE.Vector3(...data.position);
    const dir = new THREE.Vector3().subVectors(target.position, origPos).normalize();
    const newPos = origPos.addScaledVector(dir, -50);
    lightRef.current.position.copy(newPos);
  }, [data, scene]);

  if (!data) return null;

  return (
    <spotLight
      ref={lightRef}
      position={data.position}
      angle={THREE.MathUtils.degToRad((data.cone_angle_deg || 30) / 2)}
      intensity={800}
      penumbra={0.4}
      decay={1}
      distance={0}
    />
  );
}

// ------------------ MAIN TD SCENE ------------------
function TDScene() {
  const [sceneData, setSceneData] = useState(null);
  const controlsRef = useRef();
  const { gl } = useThree();

  const { lockCamera, rampFile, blackBackground } = useControls("Scene", {
    lockCamera: { value: false },
    screenshot: button(() => {
      const link = document.createElement("a");
      link.download = "screenshot.png";
      link.href = gl.domElement.toDataURL("image/png");
      link.click();
    }),
    rampFile: {
      label: "Ramp Texture",
      value: "/ramp1.png",
      image: true,
    },
    blackBackground: { value: false }, // ✅ new toggle
  });

  useEffect(() => {
    fetch("/td_scene_export.json")
      .then((res) => res.json())
      .then((data) => setSceneData(data))
      .catch((err) => console.error("Failed to load JSON:", err));
  }, []);

  if (!sceneData) return null;

  return (
    <>
      {!blackBackground && <BackgroundEnclosure rampFile={rampFile} />}
      <CameraFromTD data={sceneData.camera} />
      <LightFromTD data={sceneData.light} />
      <Prism rampFile={rampFile} />
      <OrbitingText />
      <OrbitControls
        ref={controlsRef}
        enabled={!lockCamera}
        minDistance={25}
        maxDistance={200}
      />
    </>
  );
}

export default function Scene() {
  return (
    <>
      <Canvas
        shadows={false}
        style={{ width: "100vw", height: "100vh" }}
        gl={{ antialias: true }}
        camera={{ near: 0.1, far: 2000 }}
      >
        <color attach="background" args={["black"]} /> {/* default background */}
        <Suspense fallback={null}>
          <TDScene />
        </Suspense>
      </Canvas>
      <Leva collapsed />
    </>
  );
}
