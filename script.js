
/** ===========================================================================
 * ホワイトノイズは乱数の値をそのまま直接使います。しかし乱数の世界は非常に奥が
 * 深く、より改良が加えられた特殊なノイズがいくつも存在します。
 * その中でも、比較的簡単なノイズを活用したテクニックのひとつ、バリューノイズを
 * ここでは取り上げてみます。バリューノイズを用いれば、雲のような、あるいは煙の
 * ような、独特な濃淡のある値の分布を作ることができます。
 * ホワイトノイズが単純なランダムな値の分布であったのに対し、バリューノイズの値
 * の分布は「急激な変化の少ない連続性のある分布」と言えるでしょう。
 * ========================================================================= */

// minMatrix.js に定義された算術クラス
const MAT = new matIV();
const QTN = new qtnIV();

// DOM の読み込み時に実行される処理を登録
window.addEventListener('DOMContentLoaded', () => {
  const webgl = new WebGLFrame();
  webgl.init('webgl-canvas');
  webgl.load()
  .then(() => {
    webgl.setup();
    webgl.debugSetting();
    webgl.render();
  });
}, false);

class WebGLFrame {
  constructor() {
    this.canvas    = null;
    this.gl        = null;
    this.running   = false;
    this.beginTime = 0;
    this.nowTime   = 0;
    this.render    = this.render.bind(this);

    this.camera    = new InteractionCamera();
    this.mMatrix   = MAT.identity(MAT.create());
    this.vMatrix   = MAT.identity(MAT.create());
    this.pMatrix   = MAT.identity(MAT.create());
    this.vpMatrix  = MAT.identity(MAT.create());
    this.mvpMatrix = MAT.identity(MAT.create());

    this.framebuffer = [];
    this.deleteFunction = null;

    // uniform 変数用
    this.noiseStrength = 0.5; // ノイズの合成強度 @@@
    this.noiseScale = 1.0;    // ノイズ生成の解像度のスケール @@@
  }
  /**
   * WebGL を実行するための初期化処理を行う。
   * @param {HTMLCanvasElement|string} canvas - canvas への参照か canvas の id 属性名のいずれか
   */
  init(canvas) {
    if (canvas instanceof HTMLCanvasElement === true) {
      this.canvas = canvas;
    } else if (Object.prototype.toString.call(canvas) === '[object String]') {
      const c = document.querySelector(`#${canvas}`);
      if (c instanceof HTMLCanvasElement === true) {
        this.canvas = c;
      }
    }
    if (this.canvas == null) {throw new Error('invalid argument');}
    this.gl = this.canvas.getContext('webgl');
    if (this.gl == null) {throw new Error('webgl not supported');}
  }
  /**
   * シェーダやテクスチャ用の画像など非同期で読み込みする処理を行う。
   * @return {Promise}
   */
  load() {
    // ロード完了後に必要となるプロパティを初期化
    this.program     = null;
    this.attLocation = null;
    this.attStride   = null;
    this.uniLocation = null;
    this.uniType     = null;

    // 第２のシェーダのための、プログラムオブジェクトや各種オブジェクト
    this.postProgram     = null;
    this.postAttLocation = null;
    this.postAttStride   = null;
    this.postUniLocation = null;
    this.postUniType     = null;

    return new Promise((resolve) => {
      this.loadShader([
        './vs1.vert',
        './fs1.frag',
      ])
      .then((shaders) => {
        const gl = this.gl;
        const vs = this.createShader(shaders[0], gl.VERTEX_SHADER);
        const fs = this.createShader(shaders[1], gl.FRAGMENT_SHADER);
        this.program = this.createProgram(vs, fs);
        // attribute 変数関係
        this.attLocation = [
          gl.getAttribLocation(this.program, 'position'),
          gl.getAttribLocation(this.program, 'color'),
          gl.getAttribLocation(this.program, 'texCoord'),
        ];
        this.attStride = [
          3,
          4,
          2,
        ];
        // uniform 変数関係
        this.uniLocation = [
          gl.getUniformLocation(this.program, 'mvpMatrix'),
          gl.getUniformLocation(this.program, 'textureUnit'),
        ];
        this.uniType = [
          'uniformMatrix4fv',
          'uniform1i',
        ];

        // 第２のシェーダをロードし、初期化する
        return this.loadShader([
          './vs2.vert',
          './fs2.frag',
        ]);
      })
      .then((shaders) => {
        const gl = this.gl;
        const vs = this.createShader(shaders[0], gl.VERTEX_SHADER);
        const fs = this.createShader(shaders[1], gl.FRAGMENT_SHADER);
        this.postProgram = this.createProgram(vs, fs);
        this.postAttLocation = [
          gl.getAttribLocation(this.postProgram, 'position'),
          gl.getAttribLocation(this.postProgram, 'color'),
          gl.getAttribLocation(this.postProgram, 'texCoord'),
        ];
        this.postAttStride = [
          3,
          4,
          2,
        ];
        this.postUniLocation = [
          gl.getUniformLocation(this.postProgram, 'textureUnit'),
          gl.getUniformLocation(this.postProgram, 'noiseStrength'),
          gl.getUniformLocation(this.postProgram, 'noiseScale'),
          gl.getUniformLocation(this.postProgram, 'time'),
          gl.getUniformLocation(this.postProgram, 'resolution'),
        ];
        this.postUniType = [
          'uniform1i',
          'uniform1f',
          'uniform1f',
          'uniform1f',
          'uniform2fv',
        ];

        // テクスチャ用の素材をロード
        return this.createTextureFromFile('./gradiate.png')
      })
      .then((texture) => {
        // 直前でバインドするとして、いったんプロパティに入れておく
        this.texture = texture;

        // load メソッドを解決
        resolve();
      });
    });
  }
  /**
   * WebGL のレンダリングを開始する前のセットアップを行う。
   */
  setup() {
    const gl = this.gl;

    // シンプルな XY 平面ジオメトリ
    this.position = [
      -1.0,  1.0,  0.0,
       1.0,  1.0,  0.0,
      -1.0, -1.0,  0.0,
       1.0, -1.0,  0.0,
    ];
    this.color = [
      1.0, 1.0, 1.0, 1.0,
      1.0, 1.0, 1.0, 1.0,
      1.0, 1.0, 1.0, 1.0,
      1.0, 1.0, 1.0, 1.0,
    ];
    this.texCoord = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0,
    ];
    this.indices = [
      0, 1, 2, 2, 1, 3
    ];
    this.vbo = [
      this.createVbo(this.position),
      this.createVbo(this.color),
      this.createVbo(this.texCoord),
    ];
    this.ibo = this.createIbo(this.indices);

    // 軸をラインで描画するための頂点を定義
    this.axisPosition = [
      0.0, 0.0, 0.0,
      2.0, 0.0, 0.0,
      0.0, 0.0, 0.0,
      0.0, 2.0, 0.0,
      0.0, 0.0, 0.0,
      0.0, 0.0, 2.0,
    ];
    this.axisColor = [
      0.5, 0.0, 0.0, 1.0,
      1.0, 0.2, 0.0, 1.0,
      0.0, 0.5, 0.0, 1.0,
      0.0, 1.0, 0.2, 1.0,
      0.0, 0.0, 0.5, 1.0,
      0.2, 0.0, 1.0, 1.0,
    ];
    this.axisTexCoord = [
      0.0, 0.0,
      0.0, 0.0,
      0.0, 0.0,
      0.0, 0.0,
      0.0, 0.0,
      0.0, 0.0,
    ];
    this.axisVbo = [
      this.createVbo(this.axisPosition),
      this.createVbo(this.axisColor),
      this.createVbo(this.axisTexCoord),
    ];

    // cavnas のサイズを調整し、フレームバッファを同じ大きさで生成
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.framebuffer[0] = this.createFramebuffer(this.canvas.width, this.canvas.height);

    gl.clearColor(0.4, 0.4, 0.4, 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);

    this.running = true;
    this.beginTime = Date.now();
  }
  /**
   * イベントやデバッグ用のセットアップを行う。
   */
  debugSetting() {
    // Esc キーで実行を止められるようにイベントを設定
    window.addEventListener('keydown', (evt) => {
      this.running = evt.key !== 'Escape';
    }, false);

    // リサイズイベントを設定する
    window.addEventListener('resize', () => {
      // プロパティに「フレームバッファ削除・再生成」の処理を記述した関数を代入
      this.deleteFunction = () => {
        this.framebuffer.forEach((v, index) => {
          // フレームバッファを削除するメソッドを実行
          this.deleteFrameBuffer(v);
          // リサイズ後のサイズを取得して、再度フレームバッファを生成する
          this.canvas.width = window.innerWidth;
          this.canvas.height = window.innerHeight;
          this.framebuffer[index] = this.createFramebuffer(this.canvas.width, this.canvas.height);
        });
      };
    }, false);

    // マウス関連イベントの登録
    this.camera.update();
    this.canvas.addEventListener('mousedown', this.camera.startEvent, false);
    this.canvas.addEventListener('mousemove', this.camera.moveEvent, false);
    this.canvas.addEventListener('mouseup', this.camera.endEvent, false);
    this.canvas.addEventListener('wheel', this.camera.wheelEvent, false);

    // tweakpane で GUI を生成する
    const pane = new Tweakpane.Pane();
    pane.addBlade({
      view: 'slider',
      label: 'strength',
      min: 0.0,
      max: 1.0,
      value: this.noiseStrength,
    }).on('change', v => this.noiseStrength = v.value);
    pane.addBlade({
      view: 'slider',
      label: 'scale',
      min: 0.0,
      max: 5.0,
      value: this.noiseScale,
    }).on('change', v => this.noiseScale = v.value);
  }
  /**
   * WebGL を利用して描画を行う。
   */
  render() {
    const gl = this.gl;
    if (this.running === true) {
      requestAnimationFrame(this.render);
      // もしも this.deleteFunction が null ではない場合、先に実行する
      if (this.deleteFunction != null) {
        this.deleteFunction();
        // 実行後に null を入れておく
        this.deleteFunction = null;
      }
    }

    this.nowTime = (Date.now() - this.beginTime) / 1000;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // カメラ関連のパラメータを決める
    const cameraPosition    = [0.0, 0.0, 3.0];             // カメラの座標
    const centerPoint       = [0.0, 0.0, 0.0];             // カメラの注視点
    const cameraUpDirection = [0.0, 1.0, 0.0];             // カメラの上方向
    const fovy   = 60 * this.camera.scale;                 // カメラの視野角
    const aspect = this.canvas.width / this.canvas.height; // カメラのアスペクト比
    const near   = 0.1;                                    // 最近距離クリップ面
    const far    = 10.0;                                   // 最遠距離クリップ面

    // ビュー・プロジェクション座標変換行列
    this.vMatrix  = MAT.lookAt(cameraPosition, centerPoint, cameraUpDirection);
    this.pMatrix  = MAT.perspective(fovy, aspect, near, far);
    this.vpMatrix = MAT.multiply(this.pMatrix, this.vMatrix);
    this.camera.update();
    let quaternionMatrix = MAT.identity(MAT.create());
    quaternionMatrix = QTN.toMatIV(this.camera.qtn, quaternionMatrix);
    this.vpMatrix = MAT.multiply(this.vpMatrix, quaternionMatrix);
    this.mMatrix = MAT.identity(this.mMatrix);
    this.mvpMatrix = MAT.multiply(this.vpMatrix, this.mMatrix);

    // 描画対象：フレームバッファ =========================================
    // フレームバッファをバインドしてオフスクリーンレンダリングする
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer[0].framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // どのプログラムオブジェクトを使うのかを明示し、頂点データをバインド
    gl.useProgram(this.program);
    this.setAttribute(this.vbo, this.attLocation, this.attStride, this.ibo);
    this.setUniform([
      this.mvpMatrix,
      0,
    ], this.uniLocation, this.uniType);
    gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);

    // 軸の描画
    gl.disable(gl.DEPTH_TEST);
    this.setAttribute(this.axisVbo, this.attLocation, this.attStride);
    this.setUniform([
      this.vpMatrix,
      0,
    ], this.uniLocation, this.uniType);
    gl.drawArrays(gl.LINES, 0, this.axisPosition.length / 3);
    // 描画対象：フレームバッファここまで =================================

    // 描画対象：規定のフレームバッファ ===================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.bindTexture(gl.TEXTURE_2D, this.framebuffer[0].texture);

    // どのプログラムオブジェクトを使うのかを明示し、頂点データをバインド
    gl.useProgram(this.postProgram);
    this.setAttribute(this.vbo, this.postAttLocation, this.postAttStride, this.ibo);
    this.setUniform([
      0,
      this.noiseStrength,
      this.noiseScale,
      this.nowTime,
      [this.canvas.width, this.canvas.height],
    ], this.postUniLocation, this.postUniType);
    gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);
    // 描画対象：規定のフレームバッファここまで ===========================
  }

  // utility method =========================================================

  /**
   * シェーダのソースコードを外部ファイルから取得する。
   * @param {Array.<string>} pathArray - シェーダを記述したファイルのパス（の配列）
   * @return {Promise}
   */
  loadShader(pathArray) {
    if (Array.isArray(pathArray) !== true) {
      throw new Error('invalid argument');
    }
    const promises = pathArray.map((path) => {
      return fetch(path).then((response) => {return response.text();})
    });
    return Promise.all(promises);
  }

  /**
   * シェーダオブジェクトを生成して返す。
   * コンパイルに失敗した場合は理由をアラートし null を返す。
   * @param {string} source - シェーダのソースコード文字列
   * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
   * @return {WebGLShader} シェーダオブジェクト
   */
  createShader(source, type) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return shader;
    } else {
      alert(gl.getShaderInfoLog(shader));
      return null;
    }
  }

  /**
   * プログラムオブジェクトを生成して返す。
   * シェーダのリンクに失敗した場合は理由をアラートし null を返す。
   * @param {WebGLShader} vs - 頂点シェーダオブジェクト
   * @param {WebGLShader} fs - フラグメントシェーダオブジェクト
   * @return {WebGLProgram} プログラムオブジェクト
   */
  createProgram(vs, fs) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.useProgram(program);
      return program;
    } else {
      alert(gl.getProgramInfoLog(program));
      return null;
    }
  }

  /**
   * VBO を生成して返す。
   * @param {Array} data - 頂点属性データを格納した配列
   * @return {WebGLBuffer} VBO
   */
  createVbo(data) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vbo;
  }

  /**
   * IBO を生成して返す。
   * @param {Array} data - インデックスデータを格納した配列
   * @return {WebGLBuffer} IBO
   */
  createIbo(data) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Int16Array(data), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return ibo;
  }

  /**
   * IBO を生成して返す。(INT 拡張版)
   * @param {Array} data - インデックスデータを格納した配列
   * @return {WebGLBuffer} IBO
   */
  createIboInt(data) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    if (ext == null || ext.elementIndexUint == null) {
      throw new Error('element index Uint not supported');
    }
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(data), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return ibo;
  }

  /**
   * 画像ファイルを読み込み、テクスチャを生成してコールバックで返却する。
   * @param {string} source - ソースとなる画像のパス
   * @return {Promise}
   */
  createTextureFromFile(source) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    return new Promise((resolve) => {
      const gl = this.gl;
      const img = new Image();
      img.addEventListener('load', () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        resolve(tex);
      }, false);
      img.src = source;
    });
  }

  /**
   * フレームバッファを生成して返す。
   * @param {number} width - フレームバッファの幅
   * @param {number} height - フレームバッファの高さ
   * @return {object} 生成した各種オブジェクトはラップして返却する
   * @property {WebGLFramebuffer} framebuffer - フレームバッファ
   * @property {WebGLRenderbuffer} renderbuffer - 深度バッファとして設定したレンダーバッファ
   * @property {WebGLTexture} texture - カラーバッファとして設定したテクスチャ
   */
  createFramebuffer(width, height) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    const frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    const depthRenderBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderBuffer);
    const fTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fTexture, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer: frameBuffer, renderbuffer: depthRenderBuffer, texture: fTexture};
  }

  /**
   * フレームバッファを生成して返す。（フロートテクスチャ版）
   * @param {object} ext - getWebGLExtensions の戻り値
   * @param {number} width - フレームバッファの幅
   * @param {number} height - フレームバッファの高さ
   * @return {object} 生成した各種オブジェクトはラップして返却する
   * @property {WebGLFramebuffer} framebuffer - フレームバッファ
   * @property {WebGLTexture} texture - カラーバッファとして設定したテクスチャ
   */
  createFramebufferFloat(ext, width, height) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    if (ext == null || (ext.textureFloat == null && ext.textureHalfFloat == null)) {
      throw new Error('float texture not supported');
    }
    const flg = (ext.textureFloat != null) ? gl.FLOAT : ext.textureHalfFloat.HALF_FLOAT_OES;
    const frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    const fTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, flg, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fTexture, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer: frameBuffer, texture: fTexture};
  }

  /**
   * VBO を IBO をバインドし有効化する。
   * @param {Array} vbo - VBO を格納した配列
   * @param {Array} attL - attribute location を格納した配列
   * @param {Array} attS - attribute stride を格納した配列
   * @param {WebGLBuffer} ibo - IBO
   */
  setAttribute(vbo, attL, attS, ibo) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    vbo.forEach((v, index) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, v);
      gl.enableVertexAttribArray(attL[index]);
      gl.vertexAttribPointer(attL[index], attS[index], gl.FLOAT, false, 0, 0);
    });
    if (ibo != null) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    }
  }

  /**
   * uniform 変数をまとめてシェーダに送る。
   * @param {Array} value - 各変数の値
   * @param {Array} uniL - uniform location を格納した配列
   * @param {Array} uniT - uniform 変数のタイプを格納した配列
   */
  setUniform(value, uniL, uniT) {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    value.forEach((v, index) => {
      const type = uniT[index];
      if (type.includes('Matrix') === true) {
        gl[type](uniL[index], false, v);
      } else {
        gl[type](uniL[index], v);
      }
    });
  }

  /**
   * 主要な WebGL の拡張機能を取得する。
   * @return {object} 取得した拡張機能
   * @property {object} elementIndexUint - Uint32 フォーマットを利用できるようにする
   * @property {object} textureFloat - フロートテクスチャを利用できるようにする
   * @property {object} textureHalfFloat - ハーフフロートテクスチャを利用できるようにする
   */
  getWebGLExtensions() {
    if (this.gl == null) {
      throw new Error('webgl not initialized');
    }
    const gl = this.gl;
    return {
      elementIndexUint: gl.getExtension('OES_element_index_uint'),
      textureFloat:   gl.getExtension('OES_texture_float'),
      textureHalfFloat: gl.getExtension('OES_texture_half_float')
    };
  }
  /**
   * フレームバッファを削除する。
   * @param {object} obj - createFramebuffer が返すオブジェクト
   */
  deleteFrameBuffer(obj) {
    if (this.gl == null || obj == null) {return;}
    const gl = this.gl;
    if (obj.hasOwnProperty('framebuffer') === true && this.gl.isFramebuffer(obj.framebuffer) === true) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(obj.framebuffer);
      obj.framebuffer = null;
    }
    if (obj.hasOwnProperty('renderbuffer') === true && gl.isRenderbuffer(obj.renderbuffer) === true) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.deleteRenderbuffer(obj.renderbuffer);
      obj.renderbuffer = null;
    }
    if (obj.hasOwnProperty('texture') === true && gl.isTexture(obj.texture) === true) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(obj.texture);
      obj.texture = null;
    }
    obj = null;
  }
}

/**
 * マウスでドラッグ操作を行うための簡易な実装例
 * @class
 */
class InteractionCamera {
  /**
   * @constructor
   */
  constructor() {
    this.qtn               = QTN.identity(QTN.create());
    this.dragging          = false;
    this.prevMouse         = [0, 0];
    this.rotationScale     = Math.min(window.innerWidth, window.innerHeight);
    this.rotation          = 0.0;
    this.rotateAxis        = [0.0, 0.0, 0.0];
    this.rotatePower       = 2.0;
    this.rotateAttenuation = 0.9;
    this.scale             = 1.25;
    this.scalePower        = 0.0;
    this.scaleAttenuation  = 0.8;
    this.scaleMin          = 0.25;
    this.scaleMax          = 2.0;
    this.startEvent        = this.startEvent.bind(this);
    this.moveEvent         = this.moveEvent.bind(this);
    this.endEvent          = this.endEvent.bind(this);
    this.wheelEvent        = this.wheelEvent.bind(this);
  }
  /**
   * mouse down event
   * @param {Event} eve - event object
   */
  startEvent(eve) {
    this.dragging = true;
    this.prevMouse = [eve.clientX, eve.clientY];
  }
  /**
   * mouse move event
   * @param {Event} eve - event object
   */
  moveEvent(eve) {
    if (this.dragging !== true) {return;}
    const x = this.prevMouse[0] - eve.clientX;
    const y = this.prevMouse[1] - eve.clientY;
    this.rotation = Math.sqrt(x * x + y * y) / this.rotationScale * this.rotatePower;
    this.rotateAxis[0] = y;
    this.rotateAxis[1] = x;
    this.prevMouse = [eve.clientX, eve.clientY];
  }
  /**
   * mouse up event
   */
  endEvent() {
    this.dragging = false;
  }
  /**
   * wheel event
   * @param {Event} eve - event object
   */
  wheelEvent(eve) {
    const w = eve.wheelDelta;
    const s = this.scaleMin * 0.1;
    if (w > 0) {
      this.scalePower = -s;
    } else if (w < 0) {
      this.scalePower = s;
    }
  }
  /**
   * quaternion update
   */
  update() {
    this.scalePower *= this.scaleAttenuation;
    this.scale = Math.max(this.scaleMin, Math.min(this.scaleMax, this.scale + this.scalePower));
    if (this.rotation === 0.0) {return;}
    this.rotation *= this.rotateAttenuation;
    const q = QTN.identity(QTN.create());
    QTN.rotate(this.rotation, this.rotateAxis, q);
    QTN.multiply(this.qtn, q, this.qtn);
  }
}

