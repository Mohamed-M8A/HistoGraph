// ==========================================================================
// HISTOGRAPH - URBAN GENERATION MODULE (implementation)
//
// Implements hierarchical settlement placement declared in urban.hpp.
// Scores terrain suitability using a multi-source BFS water-distance grid
// and local elevation variance, iteratively seeding metropolis, city, town,
// village, and hamlet tiers across macro, mid, and micro grid sectors.
// ==========================================================================

#include "geo.hpp"
#include <vector>
#include <algorithm>
#include <cmath>
#include <queue>

namespace {

int g_maxSettlementsCapacity = 0;

uint16_t* g_urban = nullptr;
uint16_t* g_settlementX = nullptr;
uint16_t* g_settlementY = nullptr;
uint8_t*  g_settlementTier = nullptr;
int g_settlementCount = 0;
int g_width = 0;
int g_height = 0;

std::vector<int> g_waterDist;

struct Rng {
    int64_t s;
    explicit Rng(int64_t seed) { s = seed; }
    double next() {
        s = (s * 16807) % 2147483647;
        return static_cast<double>(s - 1) / 2147483646.0;
    }
};

struct Region { int x0, y0, x1, y1; };

std::vector<int>& distance_to_water(const geo::GeoBuffers& buf) {
    size_t needed = static_cast<size_t>(buf.width) * buf.height;
    if (g_waterDist.size() != needed) {
        g_waterDist.assign(needed, -1);
    } else {
        std::fill(g_waterDist.begin(), g_waterDist.end(), -1);
    }

    std::queue<std::pair<int,int>> q;

    for (int y = 0; y < buf.height; y++) {
        for (int x = 0; x < buf.width; x++) {
            int idx = buf.idx(x, y);
            if (geo::getWater(buf.logic[idx]) == 1) {
                g_waterDist[idx] = 0;
                q.push({x, y});
            }
        }
    }

    static const int NEIGHBORS[4][2] = {{0,1},{1,0},{0,-1},{-1,0}};
    while (!q.empty()) {
        auto [cx, cy] = q.front(); q.pop();
        int cd = g_waterDist[buf.idx(cx, cy)];
        for (auto& n : NEIGHBORS) {
            int nx = cx + n[0], ny = cy + n[1];
            if (!buf.inBounds(nx, ny)) continue;
            int nidx = buf.idx(nx, ny);
            if (g_waterDist[nidx] != -1) continue;
            g_waterDist[nidx] = cd + 1;
            q.push({nx, ny});
        }
    }
    return g_waterDist;
}

double score_region(
    const geo::GeoBuffers& buf, const std::vector<int>& waterDist,
    Region r, double waterProximityWeight, int& bestX, int& bestY
) {
    int stride = std::max(1, (r.x1 - r.x0) / 12);
    double sum = 0, sumSq = 0, waterSum = 0;
    int count = 0;
    double bestLocalScore = -1e18;
    bestX = -1; bestY = -1;

    for (int y = r.y0; y < r.y1; y += stride) {
        for (int x = r.x0; x < r.x1; x += stride) {
            if (!buf.inBounds(x, y)) continue;
            int idx = buf.idx(x, y);
            if (geo::getWater(buf.logic[idx]) == 1) continue;

            double e = static_cast<double>(buf.elevation[idx]);
            sum += e;
            sumSq += e * e;
            waterSum += waterDist[idx];
            count++;
        }
    }

    if (count < 3) return -1e18;

    double mean = sum / count;
    double variance = std::max(1.0, (sumSq / count) - (mean * mean));
    double avgWaterDist = waterSum / count;

    double flatnessScore = 1.0 / std::sqrt(variance);
    double waterScore = 1.0 / (1.0 + avgWaterDist);
    double regionScore = flatnessScore + waterProximityWeight * waterScore;

    for (int y = r.y0; y < r.y1; y += stride) {
        for (int x = r.x0; x < r.x1; x += stride) {
            if (!buf.inBounds(x, y)) continue;
            int idx = buf.idx(x, y);
            if (geo::getWater(buf.logic[idx]) == 1) continue;

            double localFlat = 1.0 / (1.0 + std::abs(static_cast<double>(buf.elevation[idx]) - mean));
            double localWater = 1.0 / (1.0 + waterDist[idx]);
            double localScore = localFlat + waterProximityWeight * localWater;

            if (localScore > bestLocalScore) {
                bestLocalScore = localScore;
                bestX = x;
                bestY = y;
            }
        }
    }

    return regionScore;
}

bool too_close(int x, int y, int spacing) {
    int spacingSq = spacing * spacing;
    for (int i = 0; i < g_settlementCount; i++) {
        int dx = g_settlementX[i] - x;
        int dy = g_settlementY[i] - y;
        if (dx * dx + dy * dy < spacingSq) return true;
    }
    return false;
}

void place_settlement(int x, int y, geo::SettlementTier tier) {
    if (g_settlementCount >= g_maxSettlementsCapacity) return;

    g_settlementX[g_settlementCount] = static_cast<uint16_t>(x);
    g_settlementY[g_settlementCount] = static_cast<uint16_t>(y);
    g_settlementTier[g_settlementCount] = static_cast<uint8_t>(tier);
    g_settlementCount++;

    int idx = y * g_width + x;
    g_urban[idx] = geo::setUrbanObject(g_urban[idx], static_cast<uint8_t>(tier));
}

void seed_tier(
    const geo::GeoBuffers& buf, const std::vector<int>& waterDist,
    std::vector<Region>& regions, int gridSize, geo::SettlementTier tier,
    int maxForTier, double minSuitabilityScore, double waterProximityWeight,
    std::vector<Region>& leftoverOut
) {
    struct Candidate { Region region; double score; int bx, by; };
    std::vector<Candidate> candidates;

    for (auto& region : regions) {
        for (int y = region.y0; y < region.y1; y += gridSize) {
            for (int x = region.x0; x < region.x1; x += gridSize) {
                Region cell{x, y, std::min(x + gridSize, region.x1), std::min(y + gridSize, region.y1)};
                if (cell.x1 <= cell.x0 || cell.y1 <= cell.y0) continue;

                int bx, by;
                double score = score_region(buf, waterDist, cell, waterProximityWeight, bx, by);
                if (score >= minSuitabilityScore && bx >= 0) {
                    candidates.push_back({cell, score, bx, by});
                } else {
                    leftoverOut.push_back(cell);
                }
            }
        }
    }

    std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
        return a.score > b.score;
    });

    int placed = 0;
    int spacing = static_cast<int>(gridSize * 1.5);

    for (auto& c : candidates) {
        if (placed >= maxForTier || g_settlementCount >= g_maxSettlementsCapacity) {
            leftoverOut.push_back(c.region);
            continue;
        }
        if (too_close(c.bx, c.by, spacing)) {
            leftoverOut.push_back(c.region);
            continue;
        }
        place_settlement(c.bx, c.by, tier);
        placed++;
    }
}

}

namespace urban {

void init_urban(int width, int height, int maxSettlementsCapacity) {
    delete[] g_urban;
    delete[] g_settlementX;
    delete[] g_settlementY;
    delete[] g_settlementTier;

    g_width = width;
    g_height = height;
    g_maxSettlementsCapacity = maxSettlementsCapacity;
    int size = width * height;

    g_urban = new uint16_t[size]();
    g_settlementX = new uint16_t[g_maxSettlementsCapacity]();
    g_settlementY = new uint16_t[g_maxSettlementsCapacity]();
    g_settlementTier = new uint8_t[g_maxSettlementsCapacity]();
    g_settlementCount = 0;
}

void generate_urban(
    const geo::GeoBuffers& geoBuffers,
    int64_t seed,
    int maxSettlements,
    int macroGridSize,
    int midGridSize,
    int microGridSize,
    double minSuitabilityScore,
    double waterProximityWeight
) {
    if (!g_urban || !g_settlementX) return;

    for (int i = 0; i < g_width * g_height; i++) g_urban[i] = 0;
    g_settlementCount = 0;

    std::vector<int>& waterDist = distance_to_water(geoBuffers);

    Region fullMap{0, 0, g_width, g_height};
    std::vector<Region> macroRegions{fullMap};
    std::vector<Region> midRegions, microRegions, hamletRegions;

    int metropolisBudget = std::max(1, maxSettlements / 20);
    seed_tier(geoBuffers, waterDist, macroRegions, macroGridSize, geo::METROPOLIS,
              metropolisBudget, minSuitabilityScore, waterProximityWeight, midRegions);

    int cityBudget = std::max(1, maxSettlements / 8);
    seed_tier(geoBuffers, waterDist, midRegions, midGridSize, geo::CITY,
              cityBudget, minSuitabilityScore * 0.8, waterProximityWeight, microRegions);

    int townBudget = std::max(1, maxSettlements / 4);
    seed_tier(geoBuffers, waterDist, microRegions, microGridSize, geo::TOWN,
              townBudget, minSuitabilityScore * 0.6, waterProximityWeight, hamletRegions);

    int remaining = std::max(0, maxSettlements - g_settlementCount);
    int villageBudget = remaining / 2;
    std::vector<Region> unusedAfterVillages;
    seed_tier(geoBuffers, waterDist, hamletRegions, microGridSize, geo::VILLAGE,
              villageBudget, minSuitabilityScore * 0.4, waterProximityWeight, unusedAfterVillages);

    int hamletBudget = std::max(0, maxSettlements - g_settlementCount);
    std::vector<Region> discarded;
    seed_tier(geoBuffers, waterDist, unusedAfterVillages, microGridSize, geo::HAMLET,
              hamletBudget, minSuitabilityScore * 0.2, waterProximityWeight, discarded);
}

uint16_t* get_urban_buffer() { return g_urban; }
uint16_t* get_settlement_x() { return g_settlementX; }
uint16_t* get_settlement_y() { return g_settlementY; }
uint8_t*  get_settlement_tier() { return g_settlementTier; }
int get_settlement_count() { return g_settlementCount; }

void cleanup_urban() {
    delete[] g_urban; g_urban = nullptr;
    delete[] g_settlementX; g_settlementX = nullptr;
    delete[] g_settlementY; g_settlementY = nullptr;
    delete[] g_settlementTier; g_settlementTier = nullptr;
    g_settlementCount = 0;
}

}
