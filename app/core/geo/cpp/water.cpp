// ==========================================================================
// HISTOGRAPH - WATER GENERATION MODULE (implementation)
//
// Implements river network generation declared in water.hpp.
// Traces water paths from mountain sources via gradient descent, resolves
// local pit depressions using Bresenham line search, and rasterizes
// directional flow vectors into Buffer_Logic.
// ==========================================================================

#include "geo.hpp"
#include <vector>
#include <cmath>
#include <algorithm>

namespace {

struct Rng {
    int64_t s;
    explicit Rng(int64_t seed) { s = seed; }
    double next() {
        s = (s * 16807) % 2147483647;
        return static_cast<double>(s - 1) / 2147483646.0;
    }
};

struct Point { int x, y; };

std::vector<uint8_t> g_visited;

std::vector<Point> pick_source_points(
    const geo::GeoBuffers& buf, int count, int16_t minElevation, int16_t seaLevel, Rng& rng
) {
    int16_t threshold = minElevation;
    std::vector<Point> candidates;

    while (threshold > seaLevel) {
        candidates.clear();
        for (int y = 0; y < buf.height; y++) {
            for (int x = 0; x < buf.width; x++) {
                if (buf.elevation[buf.idx(x, y)] >= threshold) {
                    candidates.push_back({x, y});
                }
            }
        }
        if (static_cast<int>(candidates.size()) >= count) break;
        threshold -= 2000;
    }

    std::vector<Point> sources;
    for (int i = 0; i < count && !candidates.empty(); i++) {
        int idx = static_cast<int>(rng.next() * candidates.size());
        sources.push_back(candidates[idx]);
        candidates.erase(candidates.begin() + idx);
    }
    return sources;
}

bool find_escape_cell(
    const geo::GeoBuffers& buf, int cx, int cy, const std::vector<uint8_t>& visited,
    int16_t currentH, int maxRadius, Point& outEscape
) {
    for (int radius = 2; radius <= maxRadius; radius++) {
        bool found = false;
        int16_t bestH = currentH;
        Point best{0, 0};

        for (int dy = -radius; dy <= radius; dy++) {
            for (int dx = -radius; dx <= radius; dx++) {
                if (std::max(std::abs(dx), std::abs(dy)) != radius) continue;
                int nx = cx + dx, ny = cy + dy;
                if (!buf.inBounds(nx, ny)) continue;
                if (visited[buf.idx(nx, ny)]) continue;

                int16_t h = buf.elevation[buf.idx(nx, ny)];
                if (h < bestH) {
                    bestH = h;
                    best = {nx, ny};
                    found = true;
                }
            }
        }
        if (found) { outEscape = best; return true; }
    }
    return false;
}

std::vector<Point> bresenham_line(int x0, int y0, int x1, int y1) {
    std::vector<Point> points;
    int dx = std::abs(x1 - x0), dy = std::abs(y1 - y0);
    int sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    int err = dx - dy;
    int x = x0, y = y0;

    while (true) {
        points.push_back({x, y});
        if (x == x1 && y == y1) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
    }
    return points;
}

geo::FlowDirection get_direction(int x1, int y1, int x2, int y2) {
    int dx = x2 - x1, dy = y2 - y1;
    if (dx == 0 && dy < 0) return geo::N;
    if (dx > 0 && dy < 0)  return geo::NE;
    if (dx > 0 && dy == 0) return geo::E;
    if (dx > 0 && dy > 0)  return geo::SE;
    if (dx == 0 && dy > 0) return geo::S;
    if (dx < 0 && dy > 0)  return geo::SW;
    if (dx < 0 && dy == 0) return geo::W;
    if (dx < 0 && dy < 0)  return geo::NW;
    return geo::S;
}

std::vector<Point> trace_river(
    const geo::GeoBuffers& buf, Point start, int16_t seaLevel, int maxLength,
    int escapeRadius, std::vector<uint8_t>& visited
) {
    std::vector<Point> path;
    Point curr = start;

    static const int NEIGHBORS[8][2] = {
        {0,1},{1,0},{0,-1},{-1,0},{1,1},{1,-1},{-1,1},{-1,-1}
    };

    for (int step = 0; step < maxLength; step++) {
        int16_t h = buf.elevation[buf.idx(curr.x, curr.y)];
        path.push_back(curr);
        visited[buf.idx(curr.x, curr.y)] = 1;

        bool alreadyWater = geo::getWater(buf.logic[buf.idx(curr.x, curr.y)]) == 1;
        if (h <= seaLevel || alreadyWater) break;

        bool hasNext = false;
        Point next{0, 0};
        int16_t lowest = h;

        for (auto& n : NEIGHBORS) {
            int nx = curr.x + n[0], ny = curr.y + n[1];
            if (!buf.inBounds(nx, ny)) continue;
            if (visited[buf.idx(nx, ny)]) continue;

            int16_t nh = buf.elevation[buf.idx(nx, ny)];
            if (nh < lowest) {
                lowest = nh;
                next = {nx, ny};
                hasNext = true;
            }
        }

        if (!hasNext) {
            Point escape;
            if (!find_escape_cell(buf, curr.x, curr.y, visited, h, escapeRadius, escape)) break;

            auto bridge = bresenham_line(curr.x, curr.y, escape.x, escape.y);
            for (size_t i = 1; i < bridge.size(); i++) {
                path.push_back(bridge[i]);
                visited[buf.idx(bridge[i].x, bridge[i].y)] = 1;
            }
            curr = escape;
            continue;
        }
        curr = next;
    }
    return path;
}

void apply_river_to_buffers(const geo::GeoBuffers& buf, const std::vector<Point>& path) {
    size_t total = path.size();
    if (total == 0) return;

    for (size_t i = 0; i < total; i++) {
        int idx = buf.idx(path[i].x, path[i].y);
        buf.logic[idx] = geo::setWater(buf.logic[idx], 1);

        if (i < total - 1) {
            geo::FlowDirection dir = get_direction(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y);
            buf.logic[idx] = geo::setFlow(buf.logic[idx], static_cast<uint8_t>(dir));
        }
    }
}

}

namespace water {

void generate_rivers(
    const geo::GeoBuffers& buf,
    int64_t seed,
    int count,
    int16_t minSourceElevation,
    int16_t seaLevel,
    int escapeRadius,
    int maxLength
) {
    Rng rng(seed);
    auto sources = pick_source_points(buf, count, minSourceElevation, seaLevel, rng);

    size_t needed = static_cast<size_t>(buf.width) * buf.height;
    if (g_visited.size() != needed) {
        g_visited.assign(needed, 0);
    } else {
        std::fill(g_visited.begin(), g_visited.end(), 0);
    }

    for (auto& source : sources) {
        auto path = trace_river(buf, source, seaLevel, maxLength, escapeRadius, g_visited);
        if (path.size() > 5) {
            apply_river_to_buffers(buf, path);
        }
    }
}

}
