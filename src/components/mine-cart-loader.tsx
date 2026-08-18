/**
 * The mine-scene loading vignette: a loaded ore cart rolling through a
 * timber-braced tunnel. The world scrolls past a tracked camera in a
 * seamless loop; the styles live in mine.css under the mine-loader-*
 * classes, transform/opacity only.
 *
 * The loop is built on one shared ground speed so nothing slides:
 * ties tile 26px every 0.42s (61.9px/s), the wheels (r 8.5, circumference
 * 53.4px) spin once per 0.86s to match, and the rail joint crosses the
 * 220px viewBox at that same speed once per 3.78s master loop. Every
 * master-loop keyframe percentage derives from the joint passing under
 * the front wheel at 43.6% and the rear wheel at 56.4%.
 */

const TIE_OFFSETS = [0, 26, 52, 78, 104, 130, 156, 182, 208, 234, 260];
const POST_OFFSETS = [0, 110, 220, 330];

export function MineCartLoader() {
  return (
    <svg viewBox="0 0 220 88" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="mine-loader-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#10141f" />
          <stop offset="1" stopColor="#0a0d14" />
        </linearGradient>
        <radialGradient id="mine-loader-glowgrad" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f5c542" stopOpacity="0.65" />
          <stop offset="0.55" stopColor="#f5c542" stopOpacity="0.26" />
          <stop offset="1" stopColor="#f5c542" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mine-loader-hopper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#43527a" />
          <stop offset="1" stopColor="#333f5c" />
        </linearGradient>
        <linearGradient id="mine-loader-fadegrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.09" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.91" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="mine-loader-fade">
          <rect
            x="0"
            y="0"
            width="220"
            height="88"
            fill="url(#mine-loader-fadegrad)"
          />
        </mask>
      </defs>

      <g mask="url(#mine-loader-fade)">
        <rect
          x="-30"
          y="0"
          width="280"
          height="80"
          fill="url(#mine-loader-wall)"
        />
        <rect
          x="4"
          y="24"
          width="34"
          height="1.4"
          rx="0.7"
          fill="#141a28"
          opacity="0.9"
        />
        <rect
          x="52"
          y="21"
          width="22"
          height="1.2"
          rx="0.6"
          fill="#141a28"
          opacity="0.8"
        />
        <rect
          x="160"
          y="26"
          width="30"
          height="1.4"
          rx="0.7"
          fill="#141a28"
          opacity="0.9"
        />
        <rect
          x="196"
          y="44"
          width="20"
          height="1.2"
          rx="0.6"
          fill="#141a28"
          opacity="0.7"
        />
        <rect
          x="14"
          y="47"
          width="26"
          height="1.2"
          rx="0.6"
          fill="#141a28"
          opacity="0.7"
        />
        <ellipse
          cx="150"
          cy="38"
          rx="52"
          ry="34"
          fill="url(#mine-loader-glowgrad)"
          opacity="0.35"
        />

        <g className="mine-loader-posts">
          {POST_OFFSETS.map((dx) => (
            <g key={dx} transform={`translate(${dx} 0)`}>
              <rect x="-55" y="10" width="7" height="62" fill="#33281f" />
              <rect x="-49.8" y="10" width="1.8" height="62" fill="#57402e" />
              <rect x="-57" y="10" width="11" height="4" fill="#3a2e26" />
              <circle cx="-20" cy="30" r="1.2" fill="#1c2333" />
              <circle cx="10" cy="52" r="0.9" fill="#1c2333" />
              <circle cx="30" cy="20" r="1.4" fill="#1c2333" />
            </g>
          ))}
        </g>

        <rect x="-30" y="6" width="280" height="6" fill="#2c231c" />
        <rect x="-30" y="11" width="280" height="1.2" fill="#4a382a" />

        <rect x="-30" y="74" width="280" height="8" fill="#141926" />

        <g className="mine-loader-ties" data-mine-loader-bit="true">
          {TIE_OFFSETS.map((dx) => (
            <g key={dx} transform={`translate(${dx} 0)`}>
              <rect
                x="-26"
                y="71.5"
                width="9"
                height="4.5"
                rx="1"
                fill="#46352a"
              />
              <rect
                x="-26"
                y="71.5"
                width="9"
                height="1.4"
                rx="0.7"
                fill="#6a4e38"
              />
              <circle cx="-12.5" cy="78" r="1" fill="#232b3d" />
              <circle cx="-6" cy="76.5" r="0.8" fill="#1d2536" />
            </g>
          ))}
        </g>

        <rect x="-30" y="68.5" width="280" height="3" fill="#4a5670" />
        <rect
          x="-30"
          y="68.5"
          width="280"
          height="0.8"
          fill="#93a4c4"
          opacity="0.8"
        />
        <rect x="-30" y="70.7" width="280" height="0.8" fill="#333d54" />

        <g transform="translate(110 0)">
          <g className="mine-loader-joint">
            <rect x="-0.35" y="68.5" width="0.7" height="3" fill="#1a2131" />
            <rect
              x="-3.5"
              y="69.4"
              width="7"
              height="2.6"
              rx="0.6"
              fill="#333d54"
            />
            <circle cx="-1.8" cy="70.7" r="0.55" fill="#93a4c4" />
            <circle cx="1.8" cy="70.7" r="0.55" fill="#93a4c4" />
          </g>
        </g>

        <ellipse cx="110" cy="77.5" rx="33" ry="3" fill="#000" opacity="0.35" />

        <circle
          className="mine-loader-dust-1"
          cx="88"
          cy="73"
          r="2.4"
          fill="#8a7a68"
        />
        <circle
          className="mine-loader-dust-2"
          cx="90"
          cy="74"
          r="1.9"
          fill="#8a7a68"
        />
        <circle
          className="mine-loader-dust-3"
          cx="87"
          cy="74.5"
          r="2.1"
          fill="#8a7a68"
        />

        <g className="mine-loader-cart">
          <rect x="88" y="52" width="44" height="5" rx="1" fill="#1e2637" />
          <path d="M81 28 L139 28 L130 52 L90 52 Z" fill="#3a4763" />
          <path
            d="M85 31 L135 31 L127.6 49 L92.4 49 Z"
            fill="url(#mine-loader-hopper)"
          />
          <path
            d="M81 28 L96 28 L102 52 L90 52 Z"
            fill="#2e3852"
            opacity="0.55"
          />
          <path
            d="M126 31 L135 31 L127.6 49 L122 49 Z"
            fill="#f5c542"
            opacity="0.1"
          />
          <path
            d="M90 52 L130 52"
            stroke="#171e2e"
            strokeWidth="1.4"
            fill="none"
          />
          <rect
            x="101"
            y="30"
            width="3.4"
            height="22"
            fill="#26304a"
            opacity="0.9"
          />
          <rect
            x="116"
            y="30"
            width="3.4"
            height="22"
            fill="#26304a"
            opacity="0.9"
          />
          <g className="mine-loader-ore-a">
            <path d="M92 28.5 L96 20.5 L102 22 L104 28.5 Z" fill="#f5c542" />
            <path d="M96 20.5 L102 22 L100 28.5 L96.8 28.5 Z" fill="#c9942f" />
            <path
              d="M95.2 22.3 L97 21 L98.6 21.6 L96.4 23.4 Z"
              fill="#ffe9a8"
            />
          </g>
          <g className="mine-loader-ore-b">
            <path
              d="M106.5 28.5 L110 19.5 L117 21.5 L118.5 28.5 Z"
              fill="#54e0c7"
            />
            <path
              d="M110 19.5 L113.6 28.5 L106.5 28.5 Z"
              fill="#a9f3e4"
              opacity="0.85"
            />
            <path d="M117 21.5 L118.5 28.5 L114.8 28.5 Z" fill="#2e9e8c" />
          </g>
          <g className="mine-loader-ore-c">
            <path
              d="M120.5 28.5 L123 22.5 L128.5 23.8 L130 28.5 Z"
              fill="#5d6b89"
            />
            <path d="M123 22.5 L128.5 23.8 L126.6 28.5 Z" fill="#47536e" />
            <path
              d="M123.6 23.6 L125 23 L125.8 24.4 L124 24.8 Z"
              fill="#8b99b5"
            />
          </g>
          <path
            className="mine-loader-glint"
            d="M111.5 18.5 L112.6 21.4 L115.5 22.5 L112.6 23.6 L111.5 26.5 L110.4 23.6 L107.5 22.5 L110.4 21.4 Z"
            fill="#eafff9"
          />
          <rect x="79" y="26" width="62" height="4.4" rx="1.6" fill="#232c42" />
          <rect
            x="79.6"
            y="26.5"
            width="60.8"
            height="1"
            rx="0.5"
            fill="#6c7d9d"
            opacity="0.8"
          />
          <path
            d="M137.6 31 L131.8 46"
            stroke="#c08a4e"
            strokeWidth="1"
            opacity="0.5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M110 37.2 L112.6 39.6 L110 43.4 L107.4 39.6 Z"
            fill="#54e0c7"
            opacity="0.7"
          />
          <path
            d="M110 37.2 L112.6 39.6 L110 40.4 L107.4 39.6 Z"
            fill="#a9f3e4"
            opacity="0.55"
          />
          <circle cx="102.7" cy="33" r="0.95" fill="#8b99b5" />
          <circle cx="102.7" cy="48.5" r="0.95" fill="#8b99b5" />
          <circle cx="117.7" cy="33" r="0.95" fill="#8b99b5" />
          <circle cx="117.7" cy="48.5" r="0.95" fill="#8b99b5" />
          <g>
            <circle cx="95" cy="60" r="8.5" fill="#1b2233" />
            <circle
              cx="95"
              cy="60"
              r="8.5"
              fill="none"
              stroke="#6c7d9d"
              strokeWidth="1.6"
            />
            <path
              d="M89 54.5 A8.1 8.1 0 0 1 100.5 54"
              fill="none"
              stroke="#93a4c4"
              strokeWidth="0.9"
              opacity="0.55"
            />
            <g className="mine-loader-spokes">
              <path
                d="M95 53.2 L95 66.8 M88.2 60 L101.8 60"
                stroke="#55627e"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </g>
            <circle cx="95" cy="60" r="2.4" fill="#8792aa" />
            <circle cx="95" cy="60" r="0.9" fill="#26304a" />
          </g>
          <g>
            <circle cx="125" cy="60" r="8.5" fill="#1b2233" />
            <circle
              cx="125"
              cy="60"
              r="8.5"
              fill="none"
              stroke="#6c7d9d"
              strokeWidth="1.6"
            />
            <path
              d="M119 54.5 A8.1 8.1 0 0 1 130.5 54"
              fill="none"
              stroke="#93a4c4"
              strokeWidth="0.9"
              opacity="0.55"
            />
            <g className="mine-loader-spokes">
              <path
                d="M125 53.2 L125 66.8 M118.2 60 L131.8 60"
                stroke="#55627e"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </g>
            <circle cx="125" cy="60" r="2.4" fill="#8792aa" />
            <circle cx="125" cy="60" r="0.9" fill="#26304a" />
          </g>
          <path
            className="mine-loader-spark-front"
            d="M127 66 L127.8 64.6 L129.4 64.4 L128.2 63.4 L128.4 61.8 L127 62.6 L125.6 61.8 L125.8 63.4 L124.6 64.4 L126.2 64.6 Z"
            fill="#ffe9a8"
          />
          <path
            className="mine-loader-spark-rear"
            d="M97 66 L97.8 64.6 L99.4 64.4 L98.2 63.4 L98.4 61.8 L97 62.6 L95.6 61.8 L95.8 63.4 L94.6 64.4 L96.2 64.6 Z"
            fill="#ffe9a8"
          />
          <path
            d="M137 28 L145 23"
            stroke="#26304a"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <g className="mine-loader-lantern">
            <circle
              className="mine-loader-glow"
              cx="145"
              cy="31.5"
              r="11"
              fill="url(#mine-loader-glowgrad)"
            />
            <path
              d="M145 23 L145 27.6"
              stroke="#26304a"
              strokeWidth="0.9"
              fill="none"
            />
            <rect
              x="143.6"
              y="26.6"
              width="2.8"
              height="1.6"
              rx="0.5"
              fill="#26304a"
            />
            <rect
              x="142.4"
              y="28"
              width="5.2"
              height="7"
              rx="1.5"
              fill="#232c42"
              stroke="#6c7d9d"
              strokeWidth="0.6"
            />
            <circle cx="145" cy="31.5" r="1.6" fill="#ffe9a8" />
          </g>
        </g>
      </g>
    </svg>
  );
}
