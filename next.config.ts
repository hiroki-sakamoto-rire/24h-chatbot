import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run などのコンテナ向けに最小構成の出力を生成する
  output: "standalone",
};

export default nextConfig;
