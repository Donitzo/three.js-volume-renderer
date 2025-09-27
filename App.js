import VolumeRenderer from './VolumeRenderer.js';

import nifti from './nifti-reader.js';

import { OrbitControls } from './three.js/OrbitControls.js';
import * as THREE from './three.js/three.module.min.js';

const samples = {
    'Animated Smoke': 'nifti_samples/fds_smoke.nii.gz',
    'Chris TI MRI': 'nifti_samples/chris_t1.nii.gz',
    'Iguana': 'nifti_samples/Iguana.nii.gz',
};

export default class App {
    static _init() {
        window.addEventListener('load', () => {
            new App();
        });
    }

    #renderer = null;
    #scene = null;
    #camera = null;
    #orbitControls = null;
    #volumeRenderer = null;
    #spinningCube = null;
    #directionalLight = null;
    #pointLight = null;
    #renderTarget = null;
    #lastTime = null;
    #timeElement = null;
    #time = { value: 0 };
    #timescale = { value: 1 };
    #timeRange = { value: 200 };

    constructor() {
        // Create the three.js renderer
        this.#renderer = new THREE.WebGLRenderer({
            canvas: document.querySelector('canvas'),
        });

        // Create the main scene object
        this.#scene = new THREE.Scene();

        // Add lights
        this.#directionalLight = new THREE.DirectionalLight();
        this.#directionalLight.add(new THREE.Mesh(new THREE.SphereGeometry(0.03)));
        this.#directionalLight.visible = false;
        this.#scene.add(this.#directionalLight)

        this.#pointLight = new THREE.PointLight(0xffffff, 1, 3);
        this.#pointLight.add(new THREE.Mesh(new THREE.SphereGeometry(0.03)));
        this.#pointLight.visible = false;
        this.#scene.add(this.#pointLight);

        // Create axes
        const axes = new THREE.AxesHelper(0.1);
        axes.position.set(-1, -1, -1);
        this.#scene.add(axes);

        // Create a spinning cube
        this.#spinningCube = new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshLambertMaterial(),
        );
        this.#spinningCube.visible = false;
        this.#scene.add(this.#spinningCube);

        // Create a depth texture and render target
        const depthTexture = new THREE.DepthTexture();
        depthTexture.format = THREE.DepthFormat;
        depthTexture.type = THREE.UnsignedShortType;

        this.#renderTarget = new THREE.WebGLRenderTarget(64, 64, {
            depthTexture: depthTexture,
            depthBuffer: true,
        });

        // Create a perspective camera
        this.#camera = new THREE.PerspectiveCamera(75, 1, 0.01, 10);
        this.#camera.position.z = 2;

        // Create camera controls
        this.#orbitControls = new OrbitControls(this.#camera, this.#renderer.domElement);
        this.#orbitControls.enableDamping = true;
        this.#orbitControls.dampingFactor = 0.1;

        // Create a background skybox
        this.#scene.background = new THREE.CubeTextureLoader().load([
            './images/pisa/px.png', './images/pisa/nx.png',
            './images/pisa/py.png', './images/pisa/ny.png',
            './images/pisa/pz.png', './images/pisa/nz.png',
        ]);

        // Create a volume renderer
        this.#volumeRenderer = new VolumeRenderer();
        this.#scene.add(this.#volumeRenderer);

        const uniforms = this.#volumeRenderer.uniforms;
        uniforms.depthTexture.value = this.#renderTarget.depthTexture;
        uniforms.volumeSize.value.set(2, 2, 2);
        uniforms.clipMin.value.set(-1, -1, -1);
        uniforms.clipMax.value.set(1, 1, 1);
        uniforms.valueAdded.value = 0.3;

        // Create a lil.GUI
        const gui = new lil.GUI();

        // Pre-defined custom functions
        const functionPresets = {
            // A simple sphere (distance field)
            'Sphere': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return length(p);
`,
            // Sphere with a pulsating effect over time
            'Pulsing Sphere': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return length(p) + 0.1 * sin(t);
`,
            // Expanding rings based on the distance from the center
            'Expanding Rings': `
// Inverted normals
vec3 p = vec3(x, y, z) - vec3(1.0);
return sin(length(p) * 10.0 - t * 4.0);
`,
            // Cube defined by the Chebyshev distance (scaled by 2)
            'Cube': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return max(max(abs(p.x), abs(p.y)), abs(p.z)) * 2.0;
`,
            // Cube that spins over time around the Y-axis (scaled by 2)
            'Spinning Cube': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float cx = cos(t);
float sx = sin(t);
float rx = cx * p.x - sx * p.z;
float rz = sx * p.x + cx * p.z;
return max(max(abs(rx), abs(p.y)), abs(rz)) * 2.0;
`,
            // Morph between a sphere and a cube based on a sine of time
            'SphereCube Morph': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float sphere = length(p);
float cube = max(max(abs(p.x), abs(p.y)), abs(p.z));
float blend = (sin(t) + 1.0) * 0.5;
return mix(sphere, cube, blend) * 2.0;
`,
            // Torus created by taking the distance in the xz-plane
            'Torus': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float qx = length(vec2(p.x, p.z)) - 0.5;
return length(vec2(qx, p.y)) * 2.0;
`,
            // Wavy surface created from several sine waves
            'Surface': `
float wave1 = sin(x * 3.0 + t) * 0.1;
float wave2 = sin(z * 2.5 + t * 1.5) * 0.1;
float wave3 = sin((x + z) * 4.0 + t * 0.8) * 0.05;
return y - 1.0 - (wave1 + wave2 + wave3);
`,
            // A sphere with a wobbly surface determined by a time-modulated radius
            'Wobbly Sphere': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float radius = 0.5 + 0.05 * sin(10.0 * atan(p.y, p.x) + t);
return length(p) - radius;
`,
            // A twisting tunnel effect
            'Twister': `
// Inverted normals
vec3 p = vec3(x, y, z) - vec3(1.0);
float r = length(p.xy);
float theta = atan(p.y, p.x) + t + p.z * 3.0;
float nx = r * cos(theta);
float ny = r * sin(theta);
float funnel = p.z + 0.3 * r;
return sin(nx * 4.0) * cos(ny * 4.0) - funnel;
`,
            // A warp tunnel effect combining radial distance and a sine-modulated z
            'Warp Tunnel': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float r = length(vec2(p.x, p.y)) - 0.5;
return r + sin(p.z * 5.0 - t * 3.0) * 0.1;
`,
            // A flowing pattern using sine functions
            'Sine Flow': `
// Inverted normals
return sin(x * 2.0 + t) * sin(y * 2.0 - t) * sin(z * 2.0 + t);
`,
            // Gyroid minimal surface pattern
            'Gyroid': `
return (
    sin(x * 10.0) * cos(y * 10.0) +
    sin(y * 10.0) * cos(z * 10.0) +
    sin(z * 10.0) * cos(x * 10.0)
);
`,
            // Animated Gyroid pattern
            'Gyroid Animated': `
return (
    sin(x * 10.0 + t) * cos(y * 10.0) +
    sin(y * 10.0 + t) * cos(z * 10.0) +
    sin(z * 10.0 + t) * cos(x * 10.0)
);
`,
            // Smoke effect using a combination of sine waves
            'Smoke': `
return 0.2 * (
    sin(x * 7.5 + t) +
    sin(-y * 5.7 - 1.3 * t) * sin(z * 3.3 + 2.3 * t) +
    sin((x + y) * 6.2 + 2.5 * t) * sin((y + z) * 4.4 - 0.7 * t)
);
`,
            // Mandelbulb fractal distance estimator with a time offset in one of the sine functions
            'Mandelbulb': `
vec3 p = vec3(x, y, z) - vec3(1.0);
vec3 Z = p;
float dr = 1.0;
float r = 0.0;

for (int i = 0; i < 8; i++) {
    r = length(Z);
    float theta = acos(Z.z / r);
    float phi = atan(Z.y, Z.x);
    float s = step(r, 2.0);

    dr = mix(dr, pow(r, 7.0) * 8.0 * dr + 1.0, s);
    float zr = pow(r, 8.0);

    theta *= 8.0;
    phi *= 8.0;
    Z = mix(Z, zr * vec3(sin(theta + t) * cos(phi), sin(theta) * sin(phi), cos(theta)) + p, s);
}

return 0.5 * log(r) * r / dr * 10.0 + 1.0;
`,
        };

        const options = {
            distance: 1.0,
            extinctionCoefficient: 1.0,
            normalEpsilon: 0.01,

            paletteMin: 0,
            paletteMax: 1,

            useVolumetricDepthTest: false,
            useExtinctionCoefficient: true,
            useValueAsExtinctionCoefficient: false,
            usePointLights: false,
            useDirectionalLights: false,
            useRandomStart: true,
            renderMeanValue: false,
            invertNormals: false,
            renderNormals: false,

            raySteps: 64,

            functionPreset: 'Pulsing Sphere',
            useCustomFunction: false,
            customFunction: null,
            compile: () => {
                setUseCustomFunction(true);
            },

            niftiSample: 'Animated Smoke',
            niftiFile: null,
        };

        // File
        const loadNiftiFromArrayBuffer = async (data, zeroValueAdded = true) => {
            if (nifti.isCompressed(data)) {
                data = nifti.decompress(data);
            }

            if (!nifti.isNIFTI(data)) {
                console.error('Invalid NIfTI data');
                return;
            }

            const header = nifti.readHeader(data);
            const image = nifti.readImage(header, data);

            let volume;
            switch (header.datatypeCode) {
                case 2: volume = new Uint8Array(image); break;
                case 4: volume = new Int16Array(image); break;
                case 8: volume = new Int32Array(image); break;
                case 16: volume = new Float32Array(image); break;
                case 64: volume = new Float64Array(image); break;
                default: throw new Error(`Unsupported datatype ${header.datatypeCode}`);
            }

            const slope = header.scl_slope ?? 1;
            const inter = header.scl_inter ?? 0;

            const size = header.dims;
            const timeCount = size[4] ?? 1;

            const physicalSize = new THREE.Vector3(
                size[1] * header.pixDims[1],
                size[2] * header.pixDims[2],
                size[3] * header.pixDims[3]
            );
            const scale = 2 / Math.max(physicalSize.x, physicalSize.y, physicalSize.z);
            const voxelSize = new THREE.Vector3(
                header.pixDims[1] * scale,
                header.pixDims[2] * scale,
                header.pixDims[3] * scale
            );

            this.#volumeRenderer.createAtlasTexture(
                new THREE.Vector3(size[1], size[3], size[2]),
                new THREE.Vector3(-1, -1, -1),
                new THREE.Vector3(voxelSize.y, voxelSize.z, voxelSize.x),
                timeCount
            );

            const max = volume.reduce((a, x) => Math.max(a, slope * x + inter), 1e-6);

            this.#volumeRenderer.updateAtlasTexture((xi, yi, zi, x, y, z, t) => {
                const index =
                    xi +
                    zi * size[1] +
                    yi * size[1] * size[2] +
                    Math.floor(t) * size[1] * size[2] * size[3];
                return (slope * volume[index] + inter) / max;
            });

            if (zeroValueAdded) {
                uniforms.valueAdded.value =  0;
                valueAddedElement.updateDisplay();
            }
            
            this.#timeRange.value = timeCount * header.pixDims[4];
            this.#timeElement.max(this.#timeRange.value);
            timeRangeElement.updateDisplay();
        };

        const fileFolder = gui.addFolder('File');

        const loadSample = async (name, zeroValueAdded = true) => {
            const url = samples[name];
            const data = await fetch(url).then(r => r.arrayBuffer());
            await loadNiftiFromArrayBuffer(data, zeroValueAdded);
        };
        loadSample(options.niftiSample, false);

        const sample = fileFolder.add(options, 'niftiSample', Object.keys(samples))
            .name('Load Sample NIfTI file')
            .onChange(loadSample);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.nii,.nii.gz';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', async event => {
            const file = event.target.files[0];
            if (!file) return;
            const data = await file.arrayBuffer();
            await loadNiftiFromArrayBuffer(data, true);
        });

        fileFolder.add({ load: () => {
            fileInput.click() 
        }}, 'load')
            .name('Load NIfTI file')
            .domElement.title = 'Load 4D volume from NIfTI file.';

        // Custom function
        const glslTextarea = document.querySelector('.glsl');
        glslTextarea.value = functionPresets[options.functionPreset].trim();

        const setUseCustomFunction = use => {
            glslTextarea.style.visibility = use ? 'visible' : 'hidden';
            
            options.useCustomFunction = use;
            controlUseFunction.updateDisplay();

            uniforms.valueAdded.value = 0;
            valueAddedElement.updateDisplay();

            if (use) {
                this.#volumeRenderer.createAtlasTexture(
                    new THREE.Vector3(2, 2, 2),
                    new THREE.Vector3(-1, -1, -1),
                    new THREE.Vector3(2, 2, 2),
                    1
                );
                options.customFunction = glslTextarea.value;
            } else {
                options.customFunction = null;
                loadSample(options.niftiSample);
            }
            this.#volumeRenderer.updateMaterial(options);
        };

        const functionFolder = gui.addFolder('Custom Function');
        functionFolder.add(options, 'functionPreset', Object.keys(functionPresets))
            .name('Presets')
            .onChange(name => {
                glslTextarea.value = functionPresets[name].trim();
                setUseCustomFunction(true);
            })
            .domElement.title = 'Select a preset sampling custom function.';

        const controlUseFunction = functionFolder.add(options, 'useCustomFunction')
            .name('Use Function')
            .onChange(value => {
                setUseCustomFunction(value);
            });
        controlUseFunction.domElement.title = 'Whether to use the custom function instead of the 3D texture.';

        functionFolder.add(options, 'compile')
            .name('Compile function')
            .domElement.title = 'Compile and run the GLSL code.';

        // Time
        const timeFolder = gui.addFolder('Time');

        const timeRangeElement = timeFolder.add(this.#timeRange, 'value')
            .name('Time Range')
            .onChange(value => {
                this.#timeElement.max(value);
            });
        timeRangeElement.domElement.title = 'Simulation time range.';
        this.#timeElement = timeFolder.add(this.#time, 'value', 0, this.#timeRange.value)
            .name('Time Index')
        this.#timeElement.domElement.title = 'Simulation time index.';
        timeFolder.add(this.#timescale, 'value', 0, 8)
            .name('Time Scale')
            .domElement.title = 'Simulation time scale.';

        // Palette settings
        const palettes = ['Viridis', 'Rainbow', 'Plasma', 'Hot', 'Gray', 'Smoke', 'White'];
        const setPalette = name => {
            new THREE.TextureLoader().load(`./images/palettes/${name.toLowerCase()}.png`, texture => {
                uniforms.palette.value = texture;

                this.#volumeRenderer.material.needsUpdate = true;
            });
        };
        setPalette(palettes[0]);

        const updatePaletteUniforms = () => {
            const cutMin = uniforms.minCutoffValue.value;
            const cutMax = uniforms.maxCutoffValue.value;

            uniforms.minPaletteValue.value = cutMin + (cutMax - cutMin) * options.paletteMin;
            uniforms.maxPaletteValue.value = cutMin + (cutMax - cutMin) * options.paletteMax;
        };

        const folderPalette = gui.addFolder('Palette');
        folderPalette.add({ palette: palettes[0] }, 'palette', palettes)
            .name('Palette')
            .onChange(setPalette)
            .domElement.title = 'Select the color palette for mapping voxel values to colors.';
        folderPalette.add(options, 'paletteMin', 0, 1, 0.01)
            .name('Palette Min')
            .onChange(updatePaletteUniforms)
            .domElement.title = 'Relative position inside cutoff range for palette min.';
        folderPalette.add(options, 'paletteMax', 0, 1, 0.01)
            .name('Palette Max')
            .onChange(updatePaletteUniforms)
            .domElement.title = 'Relative position inside cutoff range for palette max.';
        folderPalette.add(uniforms.minCutoffValue, 'value', 0, 3, 0.01)
            .name('Min Cutoff Value')
            .onChange(updatePaletteUniforms)
            .domElement.title = 'Values below this threshold will be discarded.';
        folderPalette.add(uniforms.maxCutoffValue, 'value', 0, 3, 0.01)
            .name('Max Cutoff Value')
            .onChange(updatePaletteUniforms)
            .domElement.title = 'Values above this threshold will be discarded.';
        folderPalette.add(uniforms.cutoffFadeRange, 'value', 0, 1, 0.01)
            .name('Cutoff Fade Range')
            .domElement.title = 'Cutoff Fade Range over which the alpha fades to zero.';
        folderPalette.add(uniforms.valueMultiplier, 'value', 0, 4, 0.01)
            .name('Value Multiplier')
            .domElement.title = 'Sampled values are multiplied by this value.';
        const valueAddedElement = folderPalette.add(uniforms.valueAdded, 'value', 0, 0.5, 0.01)
            .name('Value Added');
        valueAddedElement.domElement.title = 'Value added to sampled values.';

        // Opacity settings
        // The value 3.912 corresponds approximately to 98% opacity (~2% transmittance)
        const folderOpacity = gui.addFolder('Opacity');
        const controlCoefficient = folderOpacity.add(options, 'extinctionCoefficient', 0.1, 10, 0.01)
            .name('Extinction Coefficient')
            .onChange(value => {
                options.distance = 3.912 / value;
                uniforms.extinctionCoefficient.value = value;
                controlDistance.updateDisplay();
            });
        controlCoefficient.domElement.title = 'Controls the rate at which light is absorbed in the volume (affects opacity).';
        const controlDistance = folderOpacity.add(options, 'distance', 0.1, 10, 0.01)
            .name('Visible Range (~98%)')
            .onChange(value => {
                options.extinctionCoefficient = 3.912 / value;
                uniforms.extinctionCoefficient.value = 3.912 / value;
                controlCoefficient.updateDisplay();
            });
        controlDistance.domElement.title = 'Sets the distance at which the volume reaches ~98% opacity.';
        folderOpacity.add(uniforms.extinctionMultiplier, 'value', 0, 10, 0.01)
            .name('Extinction Multiplier')
            .domElement.title = 'Multiplier applied to the extinction coefficient.';
        folderOpacity.add(uniforms.alphaMultiplier, 'value', 0, 4, 0.01)
            .name('Alpha Multiplier')
            .domElement.title = 'Multiplier applied to the final alpha value.';

        // Clipping planes
        const folderClip = gui.addFolder('Clipping planes');

        folderClip.add(uniforms.clipMin.value, 'x', -1, 1, 0.01)
            .name('Min X')
            .domElement.title = 'Edit min X plane.';
        folderClip.add(uniforms.clipMax.value, 'x', -1, 1, 0.01)
            .name('Max X')
            .domElement.title = 'Edit max X plane.';
        folderClip.add(uniforms.clipMin.value, 'y', -1, 1, 0.01)
            .name('Min Y')
            .domElement.title = 'Edit min Y plane.';
        folderClip.add(uniforms.clipMax.value, 'y', -1, 1, 0.01)
            .name('Max Y')
            .domElement.title = 'Edit max Y plane.';
        folderClip.add(uniforms.clipMin.value, 'z', -1, 1, 0.01)
            .name('Min Z')
            .domElement.title = 'Edit min Z plane.';
        folderClip.add(uniforms.clipMax.value, 'z', -1, 1, 0.01)
            .name('Max Z')
            .domElement.title = 'Edit max Z plane.';

        // Shader defines
        const folderDefine = gui.addFolder('Shader Options');
        folderDefine.add(options, 'useVolumetricDepthTest')
            .name('Depth Test')
            .onChange(value => {
                this.#spinningCube.visible = value;
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Enable volumetric depth testing.';
        folderDefine.add(options, 'renderMeanValue')
            .name('Mean Value')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Accumulate the mean value across the volume instead of alpha blending.';
        folderDefine.add(options, 'useExtinctionCoefficient')
            .name('Extinction Coefficient')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Whether to use the extinction coefficient in alpha blending.';
        folderDefine.add(options, 'useValueAsExtinctionCoefficient')
            .name('Value as Extinction')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Use the sampled value directly as the extinction coefficient.';
        folderDefine.add(options, 'usePointLights')
            .name('Point Lights')
            .onChange(value => {
                this.#pointLight.visible = value;
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Enable point lighting in alpha blending.';
        folderDefine.add(options, 'useDirectionalLights')
            .name('Directional Lights')
            .onChange(value => {
                this.#directionalLight.visible = value;
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Enable directional lighting in alpha blending.';
        folderDefine.add(options, 'useRandomStart')
            .name('Random Start')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = "Whether to randomize the ray start position to 'fuzz' sharp edges.";
        folderDefine.add(options, 'invertNormals')
            .name('Invert normals')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Whether to invert all surface normals.';
        folderDefine.add(options, 'renderNormals')
            .name('Render normals')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'Whether to render normals at the first surface hit.';

        // Light
        const folderLight = gui.addFolder('Directional Light');

        folderLight.add(this.#directionalLight.position, 'x', -2, 2, 0.1)
            .name('Position X')
            .domElement.title = 'Directional light X position.';
        folderLight.add(this.#directionalLight.position, 'y', -2, 2, 0.1)
            .name('Position Y')
            .domElement.title = 'Directional light Y position.';
        folderLight.add(this.#directionalLight.position, 'z', -2, 2, 0.1)
            .name('Position Z')
            .domElement.title = 'Directional light Z position.';

        // Ray stepping
        const folderRay = gui.addFolder('Ray Stepping');
        folderRay.add(options, 'raySteps', 2, 256, 1)
            .name('Ray Steps')
            .onChange(() => {
                this.#volumeRenderer.updateMaterial(options);
            })
            .domElement.title = 'The number of steps to split the ray into across the volume (with a variable step size).';

        // Other settings
        const folderOther = gui.addFolder('Other Settings');
        const controlEpsilon = folderOther.add(uniforms.normalEpsilon, 'value', 0.001, 0.1, 0.01)
            .name('Normal Epsilon');
        controlEpsilon.domElement.title = 'The real-unit epsilon used when estimating the forward difference for normals.';

        // For calculating delta time
        this.#lastTime = null;

        // Start main loop
        this.#renderer.setAnimationLoop(this.#update.bind(this));

        // Add an event listener to handle window resize events
        window.addEventListener('resize', this.#handleResize.bind(this));

        // Initial resize
        this.#handleResize();
    }

    #handleResize() {
        // Resize the renderer and render targets
        this.#renderer.setSize(window.innerWidth, window.innerHeight);
        this.#renderTarget.setSize(window.innerWidth, window.innerHeight);

        // Reset camera aspect and matrices
        this.#camera.aspect = window.innerWidth / window.innerHeight;
        this.#camera.updateProjectionMatrix();
    }

    #update(time) {
        // Calculate delta time (clamp to a reasonable range)
        const dt = Math.min(1, Math.max(1e-6, this.#lastTime === null ? 0 : (time - this.#lastTime) / 1000));
        this.#lastTime = time;

        // Increase volume renderer time and random value
        this.#time.value = Math.floor(((this.#time.value + dt * this.#timescale.value) %
            this.#timeRange.value) * 10000) / 10000;
        this.#timeElement.updateDisplay();
        this.#volumeRenderer.uniforms.time.value = this.#time.value;
        this.#volumeRenderer.uniforms.random.value = Math.random();

        // Spin point light
        this.#pointLight.position.set(Math.sin(time * 0.001) * 1.5, 0.5, Math.cos(time * 0.001) * 1.5);

        // Update camera controls
        this.#orbitControls.update(dt);

        if (this.#spinningCube.visible) {
            // Spin cube
            this.#spinningCube.rotation.x += dt * 0.2;
            this.#spinningCube.rotation.y += dt * 0.1;

            // Render scene into the render target if using depth testing
            this.#renderer.setRenderTarget(this.#renderTarget);
            this.#renderer.render(this.#scene, this.#camera);
        }

        // Render the final scene
        this.#renderer.setRenderTarget(null);
        this.#renderer.render(this.#scene, this.#camera);
    }
}

App._init();
