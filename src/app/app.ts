import {
  AfterViewInit,
  Component,
  OnDestroy,
  ViewChild,
  computed,
  ElementRef,
  signal,
} from '@angular/core';
import * as THREE from 'three';

interface Player {
  readonly name: string;
  readonly color: number;
  readonly cssColor: string;
  readonly start: number;
  readonly yard: readonly (readonly [number, number])[];
  readonly lane: readonly (readonly [number, number])[];
}

interface Token {
  readonly id: string;
  readonly playerIndex: number;
  readonly tokenIndex: number;
  readonly group: THREE.Group;
  readonly body: THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;
  progress: number;
  selectable: boolean;
}

interface PointerDrag {
  x: number;
  y: number;
  moved: boolean;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('board', { static: true }) private boardElement!: ElementRef<HTMLDivElement>;

  readonly players: readonly Player[] = [
    {
      name: 'Red',
      color: 0xff2731,
      cssColor: '#ff2731',
      start: 0,
      yard: [[1.35, 1.35], [1.35, 3.65], [3.65, 1.35], [3.65, 3.65]],
      lane: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    },
    {
      name: 'Blue',
      color: 0x0789ff,
      cssColor: '#0789ff',
      start: 13,
      yard: [[1.35, 10.35], [1.35, 12.65], [3.65, 10.35], [3.65, 12.65]],
      lane: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    },
    {
      name: 'Orange',
      color: 0xffa900,
      cssColor: '#ffa900',
      start: 26,
      yard: [[10.35, 10.35], [10.35, 12.65], [12.65, 10.35], [12.65, 12.65]],
      lane: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    },
    {
      name: 'Green',
      color: 0x16c900,
      cssColor: '#16c900',
      start: 39,
      yard: [[10.35, 1.35], [10.35, 3.65], [12.65, 1.35], [12.65, 3.65]],
      lane: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
    },
  ];

  readonly currentPlayerIndex = signal(0);
  readonly diceValue = signal<number | null>(null);
  readonly diceFace = signal('⚄');
  readonly diceTitle = signal('Roll the dice');
  readonly diceHint = signal('Tap to start your turn');
  readonly statusText = signal('Roll a 6 to bring a token onto the board.');
  readonly busy = signal(false);
  readonly gameOver = signal(false);
  readonly tokens = signal<Token[]>([]);
  readonly tokenStateVersion = signal(0);

  readonly currentPlayer = computed(() => this.players[this.currentPlayerIndex()]);
  readonly movableTokens = computed(() => {
    this.tokenStateVersion();
    const roll = this.diceValue();
    if (roll === null || this.busy() || this.gameOver()) return [];
    return this.tokens().filter((token) => this.canMove(token, roll));
  });
  readonly canRoll = computed(
    () => !this.busy() && !this.gameOver() && this.diceValue() === null,
  );
  readonly canReset = computed(() => !this.busy());

  private readonly route: readonly (readonly [number, number])[] = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
    [0, 7], [0, 8],
    [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
    [7, 14], [8, 14],
    [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
    [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
    [14, 7], [14, 6],
    [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
    [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    [7, 0], [6, 0],
  ];
  private readonly safeSquares = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  private readonly starSquares = new Set([8, 21, 34, 47]);
  private readonly cellSize = 0.9;

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private raycaster: THREE.Raycaster | null = null;
  private pointer = new THREE.Vector2();
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame = 0;
  private rollInterval = 0;
  private passTurnTimeout = 0;
  private dragPointer: PointerDrag | null = null;
  private cameraAzimuth = 0;
  private cameraPolar = 0.76;
  private cameraRadius = 26;

  ngAfterViewInit(): void {
    this.initializeBoard();
  }

  ngOnDestroy(): void {
    window.cancelAnimationFrame(this.animationFrame);
    window.clearInterval(this.rollInterval);
    window.clearTimeout(this.passTurnTimeout);
    this.resizeObserver?.disconnect();

    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointercancel', this.onPointerUp);
      canvas.removeEventListener('wheel', this.onWheel);
    }

    this.scene?.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer?.dispose();
  }

  homeCount(playerIndex: number): number {
    this.tokenStateVersion();
    return this.tokens().filter(
      (token) => token.playerIndex === playerIndex && token.progress === 57,
    ).length;
  }

  baseCount(playerIndex: number): number {
    this.tokenStateVersion();
    return this.tokens().filter(
      (token) => token.playerIndex === playerIndex && token.progress < 0,
    ).length;
  }

  tokenLabel(token: Token): string {
    return `Move ${this.players[token.playerIndex].name} token ${token.tokenIndex + 1}`;
  }

  rollDice(): void {
    if (!this.canRoll()) return;

    this.busy.set(true);
    this.statusText.set('The dice are rolling…');
    this.diceTitle.set('Rolling…');
    this.diceHint.set('Good luck!');
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    let frame = 0;

    this.rollInterval = window.setInterval(() => {
      this.diceFace.set(faces[this.rollRandomDie() - 1]);
      frame += 1;
      if (frame < 9) return;

      window.clearInterval(this.rollInterval);
      this.rollInterval = 0;
      const roll = this.rollRandomDie();
      this.diceValue.set(roll);
      this.diceFace.set(faces[roll - 1]);
      this.busy.set(false);

      const movable = this.tokens().filter((token) => this.canMove(token, roll));
      movable.forEach((token) => this.setTokenSelectable(token, true));
      this.diceTitle.set(`You rolled a ${roll}`);
      this.diceHint.set(movable.length ? 'Tap a glowing token' : 'No available move');
      this.statusText.set(
        movable.length
          ? movable.length === 1
            ? 'One token can move. Tap it to play.'
            : 'Choose one of your glowing tokens.'
          : roll === 6
            ? 'No tokens can move. Your turn passes.'
            : 'You need a 6 to leave base. Next player!',
      );
      this.tokenStateVersion.update((version) => version + 1);

      if (!movable.length) {
        this.passTurnTimeout = window.setTimeout(() => {
          if (this.diceValue() !== null && !this.gameOver()) this.finishTurn(false);
        }, 900);
      }
    }, 75);
  }

  async moveToken(token: Token): Promise<void> {
    const roll = this.diceValue();
    if (!token.selectable || this.busy() || roll === null || this.gameOver()) return;

    const wasInBase = token.progress < 0;
    const startPosition = token.group.position.clone();
    this.busy.set(true);
    this.setAllTokensSelectable(false);
    this.statusText.set('Your token is on the move…');

    if (wasInBase) {
      token.progress = 0;
      await this.animateTokenToCell(token, startPosition, this.tokenCell(token), 520);
    } else {
      for (let step = 0; step < roll; step += 1) {
        token.progress += 1;
        await this.animateTokenToCell(
          token,
          token.group.position.clone(),
          this.tokenCell(token),
          145,
        );
      }
    }

    let captured = false;
    if (token.progress <= 51) {
      const destinationIndex =
        (this.players[token.playerIndex].start + token.progress) % this.route.length;
      if (!this.safeSquares.has(destinationIndex)) {
        const [destinationRow, destinationCol] = this.route[destinationIndex];
        for (const other of this.tokens()) {
          if (
            other.playerIndex !== token.playerIndex &&
            other.progress >= 0 &&
            other.progress <= 51
          ) {
            const [otherRow, otherCol] = this.tokenCell(other);
            if (otherRow === destinationRow && otherCol === destinationCol) {
              this.statusText.set('Captured! Returning the token to base…');
              const from = other.group.position.clone();
              other.progress = -1;
              await this.animateTokenToCell(other, from, this.tokenCell(other), 520);
              captured = true;
            }
          }
        }
      }
    }

    if (captured) {
      await this.animateTokenToCell(
        token,
        token.group.position.clone(),
        this.tokenCell(token),
        220,
      );
    }

    this.placeAllTokens();
    this.tokenStateVersion.update((version) => version + 1);
    const homeCount = this.tokens().filter(
      (other) => other.playerIndex === token.playerIndex && other.progress === 57,
    ).length;
    if (homeCount === 4) {
      this.gameOver.set(true);
      this.diceValue.set(null);
      this.busy.set(false);
      this.statusText.set(`${this.players[token.playerIndex].name} got all four tokens home. What a game!`);
      this.updateDicePanel();
      return;
    }

    const turnMessage = wasInBase
      ? `${this.players[token.playerIndex].name} token moved onto the path.`
      : token.progress === 57
        ? 'Home! A perfect finish.'
        : captured
          ? 'Captured! That token goes back to base.'
          : `${this.players[token.playerIndex].name} token moved ${roll} spaces.`;
    this.finishTurn(roll === 6 || captured, turnMessage);
  }

  resetGame(): void {
    window.clearInterval(this.rollInterval);
    window.clearTimeout(this.passTurnTimeout);
    this.rollInterval = 0;
    this.passTurnTimeout = 0;

    this.currentPlayerIndex.set(0);
    this.diceValue.set(null);
    this.diceFace.set('⚄');
    this.diceTitle.set('Roll the dice');
    this.diceHint.set('Tap to start your turn');
    this.statusText.set('Roll a 6 to bring a token onto the board.');
    this.busy.set(false);
    this.gameOver.set(false);
    this.tokens().forEach((token) => {
      token.progress = -1;
      token.selectable = false;
      token.group.rotation.set(0, 0, 0);
    });
    this.placeAllTokens();
    this.tokenStateVersion.update((version) => version + 1);
  }

  private initializeBoard(): void {
    const host = this.boardElement.nativeElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b2740);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(this.renderer.domElement);
    this.raycaster = new THREE.Raycaster();

    this.scene.add(new THREE.HemisphereLight(0xe4eeff, 0x586078, 0.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(-7, 15, 9);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -12;
    keyLight.shadow.camera.right = 12;
    keyLight.shadow.camera.top = 12;
    keyLight.shadow.camera.bottom = -12;
    keyLight.shadow.bias = -0.0004;
    this.scene.add(keyLight);

    this.buildBoard();
    this.createTokens();
    this.updateCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.resize();
    this.animate();
  }

  private buildBoard(): void {
    const scene = this.scene;
    if (!scene) return;

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(14.5, 0.45, 14.5),
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
    );
    base.position.y = -0.24;
    base.receiveShadow = true;
    base.castShadow = true;
    scene.add(base);

    const colors = this.players.map((player) => player.color);
    const yards = [
      { row: 0, col: 0, playerIndex: 0 },
      { row: 0, col: 9, playerIndex: 1 },
      { row: 9, col: 9, playerIndex: 2 },
      { row: 9, col: 0, playerIndex: 3 },
    ];

    yards.forEach(({ row, col, playerIndex }) => {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(5.85 * this.cellSize, 0.075, 5.85 * this.cellSize),
        this.colorMaterial(colors[playerIndex], 0.82),
      );
      pad.position.copy(this.atCell(row + 2.5, col + 2.5, 0.015));
      pad.receiveShadow = true;
      scene.add(pad);

      const insetShape = new THREE.Shape();
      const half = 1.65;
      const corner = 0.28;
      insetShape.moveTo(-half + corner, -half);
      insetShape.lineTo(half - corner, -half);
      insetShape.quadraticCurveTo(half, -half, half, -half + corner);
      insetShape.lineTo(half, half - corner);
      insetShape.quadraticCurveTo(half, half, half - corner, half);
      insetShape.lineTo(-half + corner, half);
      insetShape.quadraticCurveTo(-half, half, -half, half - corner);
      insetShape.lineTo(-half, -half + corner);
      insetShape.quadraticCurveTo(-half, -half, -half + corner, -half);
      const inset = new THREE.Mesh(
        new THREE.ShapeGeometry(insetShape),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.7,
          side: THREE.DoubleSide,
        }),
      );
      inset.rotation.x = -Math.PI / 2;
      inset.position.copy(this.atCell(row + 2.5, col + 2.5, 0.08));
      inset.receiveShadow = true;
      scene.add(inset);

      this.players[playerIndex].yard.forEach(([spotRow, spotCol]) => {
        const spot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.34, 0.34, 0.025, 32),
          this.colorMaterial(colors[playerIndex], 0.7),
        );
        spot.position.copy(this.atCell(spotRow, spotCol, 0.13));
        spot.receiveShadow = true;
        scene.add(spot);
      });
    });

    const trackByCell = new Map(
      this.route.map(([row, col], index) => [`${row},${col}`, index]),
    );
    const startColor = new Map(
      this.players.map((player, index) => [player.start, index]),
    );
    const laneByCell = new Map<string, number>();
    this.players.forEach((player, playerIndex) => {
      player.lane.forEach(([row, col]) => laneByCell.set(`${row},${col}`, playerIndex));
    });

    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        const inTrackBand = (row >= 6 && row <= 8) || (col >= 6 && col <= 8);
        if (!inTrackBand) continue;

        const cellKey = `${row},${col}`;
        const trackIndex = trackByCell.get(cellKey);
        const lanePlayer = laneByCell.get(cellKey);
        let tileColor = 0xf7f8fb;
        if (lanePlayer !== undefined) tileColor = colors[lanePlayer];
        else if (trackIndex !== undefined && startColor.has(trackIndex)) {
          tileColor = colors[startColor.get(trackIndex)!];
        }

        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(this.cellSize * 0.92, 0.075, this.cellSize * 0.92),
          new THREE.MeshStandardMaterial({ color: tileColor, roughness: 0.65 }),
        );
        tile.position.copy(this.atCell(row, col, 0.08));
        tile.receiveShadow = true;
        scene.add(tile);

        if (trackIndex !== undefined && this.starSquares.has(trackIndex)) {
          this.addSafeStar(row, col);
        }
      }
    }

    this.addCenter();
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(14.7, 0.12, 14.7),
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
    );
    rim.position.y = -0.48;
    rim.receiveShadow = true;
    rim.castShadow = true;
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x1b2740, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.55;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  private addSafeStar(row: number, col: number): void {
    const shape = new THREE.Shape();
    const outerRadius = 0.31;
    const innerRadius = 0.14;
    for (let point = 0; point < 10; point += 1) {
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const radius = point % 2 === 0 ? outerRadius : innerRadius;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (point === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    const position = this.atCell(row, col, 0.122);
    const star = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    );
    star.rotation.x = -Math.PI / 2;
    star.position.copy(position);
    this.scene?.add(star);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x454545 }),
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.copy(position);
    this.scene?.add(outline);
  }

  private addCenter(): void {
    const scene = this.scene;
    if (!scene) return;
    const centerColors = this.players.map((player) => player.color);
    const center = new THREE.Mesh(
      new THREE.BoxGeometry(this.cellSize * 2.92, 0.08, this.cellSize * 2.92),
      this.colorMaterial(0xf8f9fc, 0.55),
    );
    center.position.set(0, 0.12, 0);
    center.receiveShadow = true;
    scene.add(center);

    const wedges = [
      { points: [[-1.25, 1.25], [0, 0], [1.25, 1.25]], color: centerColors[1] },
      { points: [[1.25, 1.25], [0, 0], [1.25, -1.25]], color: centerColors[2] },
      { points: [[1.25, -1.25], [0, 0], [-1.25, -1.25]], color: centerColors[3] },
      { points: [[-1.25, -1.25], [0, 0], [-1.25, 1.25]], color: centerColors[0] },
    ];
    wedges.forEach(({ points, color }) => {
      const shape = new THREE.Shape();
      shape.moveTo(points[0][0], points[0][1]);
      shape.lineTo(points[1][0], points[1][1]);
      shape.lineTo(points[2][0], points[2][1]);
      shape.closePath();
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({
          color,
          side: THREE.DoubleSide,
          roughness: 0.7,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.17;
      mesh.receiveShadow = true;
      scene.add(mesh);
    });

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.07, 32),
      this.colorMaterial(0xffffff, 0.45),
    );
    hub.position.set(0, 0.22, 0);
    hub.castShadow = true;
    scene.add(hub);
  }

  private createTokens(): void {
    const tokens = this.players.flatMap((player, playerIndex) =>
      player.yard.map((_, tokenIndex) => {
        const material = new THREE.MeshStandardMaterial({
          color: player.color,
          roughness: 0.6,
        });
        const group = new THREE.Group();
        const hitArea = new THREE.Mesh(
          new THREE.CylinderGeometry(0.45, 0.45, 0.5, 24),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            colorWrite: false,
            depthWrite: false,
          }),
        );
        hitArea.position.y = 0.28;
        group.add(hitArea);

        const body = new THREE.Mesh(
          new THREE.ConeGeometry(0.33, 0.54, 32),
          material,
        );
        body.position.y = 0.34;
        group.add(body);

        const token: Token = {
          id: `${playerIndex}-${tokenIndex}`,
          playerIndex,
          tokenIndex,
          progress: -1,
          group,
          body,
          selectable: false,
        };
        group.userData['token'] = token;
        this.scene?.add(group);
        return token;
      }),
    );
    this.tokens.set(tokens);
    this.placeAllTokens();
  }

  private tokenCell(token: Token): readonly [number, number] {
    if (token.progress < 0) return this.players[token.playerIndex].yard[token.tokenIndex];
    if (token.progress <= 51) {
      return this.route[(this.players[token.playerIndex].start + token.progress) % 52];
    }
    if (token.progress <= 56) {
      return this.players[token.playerIndex].lane[token.progress - 52];
    }
    return [7, 7];
  }

  private tokenOffset(token: Token): readonly [number, number] {
    const offsets: readonly (readonly [number, number])[] = [
      [-0.16, -0.16],
      [0.16, -0.16],
      [-0.16, 0.16],
      [0.16, 0.16],
    ];
    if (token.progress < 0) return [0, 0];

    const [row, col] = this.tokenCell(token);
    const stacked = this.tokens().filter((other) => {
      if (other.progress < 0) return false;
      const [otherRow, otherCol] = this.tokenCell(other);
      return otherRow === row && otherCol === col;
    });
    if (stacked.length < 2) return [0, 0];
    stacked.sort(
      (a, b) => a.playerIndex - b.playerIndex || a.tokenIndex - b.tokenIndex,
    );
    return offsets[stacked.indexOf(token) % offsets.length];
  }

  private placeToken(token: Token): void {
    const [row, col] = this.tokenCell(token);
    const [dx, dz] = this.tokenOffset(token);
    token.group.position.set(
      (col - 7) * this.cellSize + dx,
      0.13,
      (row - 7) * this.cellSize + dz,
    );
  }

  private placeAllTokens(): void {
    this.tokens().forEach((token) => this.placeToken(token));
  }

  private canMove(token: Token, roll: number): boolean {
    if (token.playerIndex !== this.currentPlayerIndex() || token.progress === 57) {
      return false;
    }
    if (token.progress < 0) return roll === 6;
    return token.progress + roll <= 57;
  }

  private rollRandomDie(): number {
    const values = new Uint32Array(1);
    const limit = 0x100000000 - (0x100000000 % 6);
    do {
      window.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return (values[0] % 6) + 1;
  }

  private finishTurn(extraTurn: boolean, message?: string): void {
    this.diceValue.set(null);
    this.busy.set(false);
    this.setAllTokensSelectable(false);
    if (!extraTurn) this.currentPlayerIndex.update((index) => (index + 1) % 4);
    this.updateDicePanel();
    this.statusText.set(
      extraTurn
        ? `${message ?? 'Nice move!'} ${this.currentPlayer().name} earned another turn. Roll again!`
        : message ?? 'Roll a 6 to bring a token onto the board.',
    );
  }

  private updateDicePanel(): void {
    if (this.gameOver()) {
      this.diceTitle.set('Game complete');
      this.diceHint.set('Start a new game to play again');
    } else {
      this.diceTitle.set('Roll the dice');
      this.diceHint.set(this.busy() ? 'Moving token…' : 'Tap to start your turn');
    }
  }

  private setAllTokensSelectable(selectable: boolean): void {
    this.tokens().forEach((token) => this.setTokenSelectable(token, selectable));
  }

  private setTokenSelectable(token: Token, selectable: boolean): void {
    token.selectable = selectable;
    token.group.scale.setScalar(selectable ? 1.08 : 1);
    if (!selectable) token.group.position.y = 0.13;
  }

  private animateTokenToCell(
    token: Token,
    from: THREE.Vector3,
    cell: readonly [number, number],
    duration: number,
  ): Promise<void> {
    const [row, col] = cell;
    const [dx, dz] = this.tokenOffset(token);
    const to = new THREE.Vector3(
      (col - 7) * this.cellSize + dx,
      0.13,
      (row - 7) * this.cellSize + dz,
    );
    const start = performance.now();

    return new Promise((resolve) => {
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - start) / duration);
        const eased =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        token.group.position.lerpVectors(from, to, eased);
        token.group.position.y += Math.sin(progress * Math.PI) * 0.42;
        token.group.rotation.y += 0.045;
        if (progress < 1) {
          window.requestAnimationFrame(tick);
        } else {
          token.group.position.copy(to);
          resolve();
        }
      };
      window.requestAnimationFrame(tick);
    });
  }

  private animate = (): void => {
    this.animationFrame = window.requestAnimationFrame(this.animate);
    const time = performance.now() * 0.001;
    this.tokens().forEach((token) => {
      token.body.material.emissive.setHex(
        token.selectable ? this.players[token.playerIndex].color : 0x000000,
      );
      token.body.material.emissiveIntensity = token.selectable
        ? 0.2 + Math.sin(time * 6) * 0.11
        : 0;
      if (token.selectable) {
        token.group.position.y = 0.13 + Math.sin(time * 4 + token.tokenIndex) * 0.055;
      }
    });
    this.renderer?.render(this.scene!, this.camera!);
  };

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.boardElement.nativeElement.clientWidth);
    const height = Math.max(1, this.boardElement.nativeElement.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.cameraRadius = 26 + Math.max(0, 1 - width / height) * 35;
    this.updateCamera();
  }

  private updateCamera(): void {
    if (!this.camera) return;
    const sin = Math.sin(this.cameraPolar);
    this.camera.position.set(
      Math.sin(this.cameraAzimuth) * sin * this.cameraRadius,
      Math.cos(this.cameraPolar) * this.cameraRadius,
      Math.cos(this.cameraAzimuth) * sin * this.cameraRadius,
    );
    // Shift along the camera's down direction without changing the viewing angle.
    const target = new THREE.Vector3(
      Math.sin(this.cameraAzimuth) * Math.cos(this.cameraPolar),
      -Math.cos(this.cameraAzimuth) * sin,
      Math.cos(this.cameraAzimuth) * Math.cos(this.cameraPolar),
    ).multiplyScalar(1.5);
    this.camera.position.add(target);
    this.camera.lookAt(target);
  }

  private colorMaterial(color: number, roughness = 0.72): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness });
  }

  private atCell(row: number, col: number, y = 0): THREE.Vector3 {
    return new THREE.Vector3(
      (col - 7) * this.cellSize,
      y,
      (row - 7) * this.cellSize,
    );
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragPointer = { x: event.clientX, y: event.clientY, moved: false };
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragPointer) return;
    const dx = event.clientX - this.dragPointer.x;
    const dy = event.clientY - this.dragPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.dragPointer.moved = true;
    if (this.dragPointer.moved) {
      this.cameraAzimuth -= dx * 0.006;
      this.cameraPolar = Math.max(
        0.3,
        Math.min(1.25, this.cameraPolar + dy * 0.004),
      );
      this.updateCamera();
    }
    this.dragPointer.x = event.clientX;
    this.dragPointer.y = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.dragPointer) return;
    const moved = this.dragPointer.moved;
    this.dragPointer = null;
    if (moved || !this.camera || !this.raycaster || !this.renderer) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersection = this.raycaster
      .intersectObjects(this.tokens().map((token) => token.group), true)
      .find((hit) => hit.object.parent?.userData['token'] !== undefined);
    const token = intersection?.object.parent?.userData['token'] as Token | undefined;
    if (token?.selectable) void this.moveToken(token);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cameraRadius = Math.max(
      18,
      Math.min(42, this.cameraRadius + event.deltaY * 0.012),
    );
    this.updateCamera();
  };
}
